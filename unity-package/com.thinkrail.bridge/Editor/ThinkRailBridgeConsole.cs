using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;

namespace UnityRail.Bridge
{
    public static class ConsoleBuffer
    {
        private static readonly object Gate = new object();
        private static readonly List<ConsoleEntry> Entries = new List<ConsoleEntry>();
        private static long _seq;
        private static int _dropped;
        private static bool _dirty;
        private static double _lastPersist;

        public static void Rehydrate()
        {
            lock (Gate)
            {
                Entries.Clear();
                _seq = 0;
                _dropped = 0;
                string json = SessionState.GetString(BridgeState.SessionConsole, "");
                if (!string.IsNullOrEmpty(json))
                {
                    try
                    {
                        List<ConsoleEntry> restored = JsonConvert.DeserializeObject<List<ConsoleEntry>>(
                            json, BridgeState.JsonSettings);
                        if (restored != null)
                        {
                            Entries.AddRange(restored);
                            foreach (ConsoleEntry entry in restored)
                            {
                                if (entry.seq > _seq) _seq = entry.seq;
                            }
                            while (Entries.Count > BridgeState.ConsoleCapacity) Entries.RemoveAt(0);
                        }
                    }
                    catch
                    {
                        // A corrupt buffer is not worth failing the Editor over.
                    }
                }
                _seq = Math.Max(_seq, SessionState.GetInt(BridgeState.SessionConsoleSeq, 0));
                _dropped = SessionState.GetInt(BridgeState.SessionConsoleDropped, 0);
                _dirty = false;
            }
        }

        public static void Add(LogType type, string message, string stackTrace)
        {
            if (string.IsNullOrEmpty(message)) return;
            lock (Gate)
            {
                _seq += 1;
                Entries.Add(new ConsoleEntry
                {
                    seq = _seq,
                    time = BridgeState.Now(),
                    level = LevelOf(type),
                    message = Truncate(message, 8000),
                    stackTrace = Truncate(stackTrace, 8000),
                });
                if (Entries.Count > BridgeState.ConsoleCapacity)
                {
                    Entries.RemoveAt(0);
                    _dropped += 1;
                }
                _dirty = true;
            }
        }

        private static string LevelOf(LogType type)
        {
            switch (type)
            {
                case LogType.Error: return "error";
                case LogType.Assert: return "assert";
                case LogType.Warning: return "warning";
                case LogType.Exception: return "exception";
                default: return "log";
            }
        }

        private static string Truncate(string value, int max)
        {
            if (string.IsNullOrEmpty(value) || value.Length <= max) return value;
            return value.Substring(0, max) + "\n[truncated]";
        }

        public static long CurrentSeq
        {
            get { lock (Gate) return _seq; }
        }

        public static int Dropped
        {
            get { lock (Gate) return _dropped; }
        }

        public static List<ConsoleEntry> Read(long since, int limit, HashSet<string> levels)
        {
            lock (Gate)
            {
                int take = limit <= 0 ? 200 : Math.Min(limit, BridgeState.ConsoleCapacity);
                List<ConsoleEntry> result = new List<ConsoleEntry>();
                foreach (ConsoleEntry entry in Entries)
                {
                    if (entry.seq <= since) continue;
                    if (levels != null && levels.Count > 0 && !levels.Contains(entry.level)) continue;
                    result.Add(entry);
                    if (result.Count >= take) break;
                }
                return result;
            }
        }

        public static void Clear()
        {
            lock (Gate)
            {
                Entries.Clear();
                _dirty = true;
            }
            Persist();
        }

        public static void Tick()
        {
            if (!_dirty) return;
            double now = EditorApplication.timeSinceStartup;
            if (now - _lastPersist < 5.0) return;
            Persist();
        }

        public static void Persist()
        {
            List<ConsoleEntry> snapshot;
            long seq;
            int dropped;
            lock (Gate)
            {
                snapshot = Entries.ToList();
                seq = _seq;
                dropped = _dropped;
                _dirty = false;
                _lastPersist = EditorApplication.timeSinceStartup;
            }
            SessionState.SetString(BridgeState.SessionConsole, BridgeState.ToJson(snapshot));
            SessionState.SetInt(BridgeState.SessionConsoleSeq, (int)Math.Min(int.MaxValue, seq));
            SessionState.SetInt(BridgeState.SessionConsoleDropped, dropped);
        }
    }
}
