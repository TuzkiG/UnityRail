using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.Sockets;
using System.Text;
using Newtonsoft.Json;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace UnityRail.Bridge
{
    [InitializeOnLoad]
    public static class ThinkRailBridgeBootstrap
    {
        static ThinkRailBridgeBootstrap()
        {
            EditorApplication.delayCall += ThinkRailBridgeLifecycle.Initialize;
        }
    }

    public static class ThinkRailBridgeLifecycle
    {
        private static bool _subscribed;
        private static long _compileStartedTicks;
        private static long _compileConsoleSeq;

        // Encoding.UTF8 emits a BOM, which turns the discovery file into invalid JSON for a plain
        // `JSON.parse` on the host side. Both files are machine-read, so write them BOM-free.
        private static readonly Encoding Utf8NoBom = new UTF8Encoding(false);

        public static void Initialize()
        {
            EditorApplication.quitting += OnQuit;
            if (BridgeState.AutoStart)
            {
                Start();
            }
            else
            {
                Debug.Log("[UnityRail] Unity bridge is installed but auto-start is off. Use Tools > UnityRail > Start Unity Bridge.");
            }
        }

        public static void Start()
        {
            if (BridgeRuntime.Running) return;
            BridgeState.LoadPersistedState();
            ConsoleBuffer.Rehydrate();
            BridgeState.LoadPersistedTestRun();
            Subscribe();
            BridgeRuntime.Token = Guid.NewGuid().ToString("N");

            int port;
            try
            {
                port = StartServer();
            }
            catch (Exception error)
            {
                Unsubscribe();
                BridgeRuntime.Token = "";
                Debug.LogError("[UnityRail] Could not start the Unity bridge: " + error.Message);
                throw;
            }
            BridgeRuntime.StartedAt = BridgeState.Now();
            BridgeRuntime.Running = true;
            WriteDiscovery();
            WriteRegistry();
            Application.logMessageReceivedThreaded += OnLog;
            EditorApplication.update += Update;
            Debug.Log("[UnityRail] Unity bridge listening on http://127.0.0.1:" + port + " for " + BridgeState.ProjectPath);
        }

        public static void Stop()
        {
            Stop(true);
        }

        public static void Stop(bool deleteDiscovery)
        {
            if (!BridgeRuntime.Running && BridgeRuntime.Server == null) return;
            Unsubscribe();
            Application.logMessageReceivedThreaded -= OnLog;
            EditorApplication.update -= Update;
            try
            {
                if (BridgeRuntime.Server != null) BridgeRuntime.Server.Stop();
            }
            catch
            {
                // The listener is already closed.
            }
            BridgeRuntime.Server = null;
            BridgeRuntime.Running = false;
            ConsoleBuffer.Persist();
            BridgeState.PersistCompile();
            BridgeState.PersistTestRun();
            if (deleteDiscovery) DeleteDiscovery();
            RemoveRegistry();
        }

        private static int StartServer()
        {
            int preferred = Math.Max(1024, BridgeState.PreferredPort);
            int lastError = 0;
            for (int port = preferred; port <= BridgeState.MaxPort; port++)
            {
                try
                {
                    BridgeRuntime.Server = new ThinkRailBridgeServer(port, BridgeRoutes.Handle);
                    BridgeState.PreferredPort = BridgeRuntime.Server.Port;
                    return BridgeRuntime.Server.Port;
                }
                catch (SocketException error)
                {
                    lastError = error.ErrorCode;
                }
            }
            throw new Exception("No free loopback port between " + preferred + " and " + BridgeState.MaxPort + " (last socket error " + lastError + ").");
        }

        private static void Subscribe()
        {
            if (_subscribed) return;
            _subscribed = true;
            CompilationPipeline.compilationStarted += OnCompilationStarted;
            CompilationPipeline.assemblyCompilationFinished += OnAssemblyCompilationFinished;
            CompilationPipeline.compilationFinished += OnCompilationFinished;
            AssemblyReloadEvents.beforeAssemblyReload += OnBeforeAssemblyReload;
        }

        private static void Unsubscribe()
        {
            if (!_subscribed) return;
            _subscribed = false;
            CompilationPipeline.compilationStarted -= OnCompilationStarted;
            CompilationPipeline.assemblyCompilationFinished -= OnAssemblyCompilationFinished;
            CompilationPipeline.compilationFinished -= OnCompilationFinished;
            AssemblyReloadEvents.beforeAssemblyReload -= OnBeforeAssemblyReload;
        }

        private static void OnQuit()
        {
            Stop(true);
        }

        private static void OnBeforeAssemblyReload()
        {
            ConsoleBuffer.Persist();
            BridgeState.PersistCompile();
            BridgeState.PersistTestRun();
            Stop(false);
        }

        private static void Update()
        {
            MainThread.Pump();
            ApplyPendingPlay();
            ConsoleBuffer.Tick();
            CompileWatchdog();
        }

        private static int _pendingPlayTicks;

        /** Ask for Play Mode on a later editor tick; `EditorApplication.delayCall` is not dependable while
         * the Editor is unfocused, and our own update pump always runs. */
        public static void RequestPlay()
        {
            _pendingPlayTicks = 2;
        }

        private static void ApplyPendingPlay()
        {
            if (_pendingPlayTicks <= 0) return;
            _pendingPlayTicks -= 1;
            if (_pendingPlayTicks > 0) return;
            if (EditorApplication.isPlaying || EditorApplication.isCompiling) return;
            EditorApplication.isPaused = false;
            EditorApplication.isPlaying = true;
        }

        private static void CompileWatchdog()
        {
            if (!BridgeState.Compiling || BridgeState.Compile.state != "compiling") return;
            if (EditorApplication.isCompiling) return;
            // A requested compile can sit in Unity's queue while it imports. Only the compile itself gets
            // the long budget; a request that never started is given a short grace period, so a busy
            // Editor is not reported as a failed compile.
            if (_compileStartedTicks > 0)
            {
                double elapsed = (DateTime.UtcNow.Ticks - _compileStartedTicks) / (double)TimeSpan.TicksPerSecond;
                if (elapsed < 180.0) return;
            }
            else if (SecondsSinceCompileRequest() < 30.0)
            {
                return;
            }
            BridgeState.Compiling = false;
            BridgeState.Compile.state = "failed";
            BridgeState.Compile.finishedAt = BridgeState.Now();
            BridgeState.Compile.diagnostics.Add(new BridgeDiagnostic
            {
                severity = "error",
                message =
                    _compileStartedTicks > 0
                        ? "Unity did not report a compile result within 180 seconds."
                        : "Unity did not start the requested compile within 30 seconds.",
            });
            BridgeState.PersistCompile();
        }

        private static double SecondsSinceCompileRequest()
        {
            DateTime started;
            if (!DateTime.TryParse(
                    BridgeState.Compile.startedAt,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind,
                    out started))
            {
                return 0;
            }
            return (DateTime.UtcNow - started.ToUniversalTime()).TotalSeconds;
        }

        private static void OnCompilationStarted(object context)
        {
            if (BridgeState.Compile.state != "compiling")
            {
                int id = Math.Max(BridgeState.Compile.id, BridgeState.RequestedCompileId) + 1;
                BridgeState.Compile = new CompileRecord
                {
                    id = id,
                    state = "compiling",
                    startedAt = BridgeState.Now(),
                };
            }
            BridgeState.Compiling = true;
            _compileStartedTicks = DateTime.UtcNow.Ticks;
            _compileConsoleSeq = ConsoleBuffer.CurrentSeq;
            BridgeState.PersistCompile();
        }

        private static void OnAssemblyCompilationFinished(string assemblyPath, CompilerMessage[] messages)
        {
            if (messages == null || messages.Length == 0) return;
            string assembly = Path.GetFileNameWithoutExtension(assemblyPath);
            foreach (CompilerMessage message in messages)
            {
                if (message.type != CompilerMessageType.Error && message.type != CompilerMessageType.Warning) continue;
                BridgeState.Compile.diagnostics.Add(new BridgeDiagnostic
                {
                    severity = message.type == CompilerMessageType.Error ? "error" : "warning",
                    message = message.message,
                    file = message.file,
                    line = message.line,
                    column = message.column,
                    assembly = assembly,
                });
            }
            BridgeState.PersistCompile();
        }

        private static void OnCompilationFinished(object context)
        {
            if (BridgeState.Compile.state != "compiling") return;
            // Only the compiler decides whether the compile failed. Console errors raised while the
            // assembly builds (an editor script logging at startup, a domain-reload message) are runtime
            // noise, not compiler diagnostics, and must not turn a clean compile into a failure.
            bool failed = false;
            foreach (BridgeDiagnostic diagnostic in BridgeState.Compile.diagnostics)
            {
                if (diagnostic.severity == "error")
                {
                    failed = true;
                    break;
                }
            }
            BridgeState.Compile.state = failed ? "failed" : "succeeded";
            BridgeState.Compile.finishedAt = BridgeState.Now();
            if (_compileStartedTicks > 0)
            {
                BridgeState.Compile.durationMs = (long)Math.Round(
                    (DateTime.UtcNow.Ticks - _compileStartedTicks) / (double)TimeSpan.TicksPerMillisecond);
            }
            BridgeState.Compiling = false;
            BridgeState.PersistCompile();
        }

        private static void OnLog(string condition, string stackTrace, LogType type)
        {
            ConsoleBuffer.Add(type, condition, stackTrace);
        }

        private static void WriteDiscovery()
        {
            BridgeDiscovery discovery = CurrentDiscovery();
            try
            {
                string directory = Path.GetDirectoryName(BridgeState.DiscoveryPath);
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                File.WriteAllText(BridgeState.DiscoveryPath, BridgeState.ToJson(discovery), Utf8NoBom);
            }
            catch (Exception error)
            {
                Debug.LogWarning("[UnityRail] Could not write bridge discovery file: " + error.Message);
            }
        }

        private static void DeleteDiscovery()
        {
            try
            {
                if (File.Exists(BridgeState.DiscoveryPath)) File.Delete(BridgeState.DiscoveryPath);
            }
            catch
            {
                // A stale discovery file is cleaned up by the host's liveness check.
            }
        }

        private static BridgeDiscovery CurrentDiscovery()
        {
            return new BridgeDiscovery
            {
                protocolVersion = BridgeState.ProtocolVersion,
                port = BridgeRuntime.Server != null ? BridgeRuntime.Server.Port : BridgeState.PreferredPort,
                token = BridgeRuntime.Token,
                pid = Process.GetCurrentProcess().Id,
                projectPath = BridgeState.ProjectPath,
                unityVersion = Application.unityVersion,
                startedAt = BridgeRuntime.StartedAt,
            };
        }

        private static void WriteRegistry()
        {
            try
            {
                RegistryFile file = ReadRegistry();
                string project = BridgeState.ProjectPath;
                file.bridges.RemoveAll(delegate(BridgeDiscovery entry)
                {
                    return entry == null || SamePath(entry.projectPath, project) || !IsAlive(entry.pid);
                });
                file.bridges.Add(CurrentDiscovery());
                string directory = Path.GetDirectoryName(BridgeState.RegistryPath);
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                File.WriteAllText(BridgeState.RegistryPath, BridgeState.ToJson(file), Utf8NoBom);
            }
            catch (Exception error)
            {
                Debug.LogWarning("[UnityRail] Could not update the bridge registry: " + error.Message);
            }
        }

        private static void RemoveRegistry()
        {
            try
            {
                if (!File.Exists(BridgeState.RegistryPath)) return;
                RegistryFile file = ReadRegistry();
                string project = BridgeState.ProjectPath;
                file.bridges.RemoveAll(delegate(BridgeDiscovery entry)
                {
                    return entry == null || SamePath(entry.projectPath, project) || !IsAlive(entry.pid);
                });
                File.WriteAllText(BridgeState.RegistryPath, BridgeState.ToJson(file), Utf8NoBom);
            }
            catch
            {
                // The registry is a discovery convenience; the project-local file is authoritative.
            }
        }

        private static RegistryFile ReadRegistry()
        {
            if (!File.Exists(BridgeState.RegistryPath)) return new RegistryFile();
            try
            {
                RegistryFile file = JsonConvert.DeserializeObject<RegistryFile>(
                    File.ReadAllText(BridgeState.RegistryPath), BridgeState.JsonSettings);
                if (file == null) return new RegistryFile();
                if (file.bridges == null) file.bridges = new List<BridgeDiscovery>();
                return file;
            }
            catch
            {
                return new RegistryFile();
            }
        }

        private static bool SamePath(string a, string b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
            StringComparison comparison = Application.platform == RuntimePlatform.WindowsEditor
                ? StringComparison.OrdinalIgnoreCase
                : StringComparison.Ordinal;
            return string.Equals(Path.GetFullPath(a).TrimEnd('\\', '/'), Path.GetFullPath(b).TrimEnd('\\', '/'), comparison);
        }

        private static bool IsAlive(int pid)
        {
            if (pid <= 0) return false;
            try
            {
                Process.GetProcessById(pid);
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}
