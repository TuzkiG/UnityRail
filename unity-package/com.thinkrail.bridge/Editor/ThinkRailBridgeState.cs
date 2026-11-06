using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;

namespace UnityRail.Bridge
{
    [Serializable]
    public class BridgeDiagnostic
    {
        public string severity;
        public string message;
        public string file;
        public int line;
        public int column;
        public string assembly;
    }

    [Serializable]
    public class CompileRecord
    {
        public int id;
        public string state = "idle";
        public string startedAt;
        public string finishedAt;
        public long durationMs;
        public List<BridgeDiagnostic> diagnostics = new List<BridgeDiagnostic>();
    }

    [Serializable]
    public class ConsoleEntry
    {
        public long seq;
        public string time;
        public string level;
        public string message;
        public string stackTrace;
    }

    [Serializable]
    public class TestResultRecord
    {
        public string name;
        public string fullName;
        public string status;
        public long durationMs;
        public string message;
        public string stackTrace;
    }

    [Serializable]
    public class TestRunRecord
    {
        public string runId;
        public string mode;
        public string state = "running";
        public string startedAt;
        public string finishedAt;
        public long durationMs;
        public int passed;
        public int failed;
        public int skipped;
        public List<TestResultRecord> results = new List<TestResultRecord>();
        public string error;
    }

    [Serializable]
    public class BridgeDiscovery
    {
        public int protocolVersion;
        public int port;
        public string token;
        public int pid;
        public string projectPath;
        public string unityVersion;
        public string startedAt;
    }

    [Serializable]
    public class RegistryFile
    {
        public List<BridgeDiscovery> bridges = new List<BridgeDiscovery>();
    }

    public static class BridgeState
    {
        public const int ProtocolVersion = 3;
        public const int DefaultPort = 39217;
        public const int MaxPort = 39250;
        public const int ConsoleCapacity = 1000;

        public const string SessionCompile = "UnityRail.Bridge.Compile";
        public const string SessionConsole = "UnityRail.Bridge.Console";
        public const string SessionConsoleSeq = "UnityRail.Bridge.ConsoleSeq";
        public const string SessionConsoleDropped = "UnityRail.Bridge.ConsoleDropped";
        public const string SessionTestRun = "UnityRail.Bridge.TestRun";
        public const string SessionAutoStart = "UnityRail.Bridge.AutoStart";
        public const string SessionPort = "UnityRail.Bridge.Port";

        public static readonly JsonSerializerSettings JsonSettings = new JsonSerializerSettings
        {
            NullValueHandling = NullValueHandling.Ignore,
            Formatting = Formatting.None,
            DateParseHandling = DateParseHandling.None,
        };

        public static string ProjectPath
        {
            get { return Path.GetFullPath(Path.Combine(Application.dataPath, "..")); }
        }

        public static string DiscoveryPath
        {
            get { return Path.Combine(ProjectPath, "Library", "ThinkRailBridge.json"); }
        }

        public static string RegistryPath
        {
            get
            {
                string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                return Path.Combine(home, ".thinkrail", "unity", "bridges.json");
            }
        }

        public static string Now()
        {
            return DateTime.UtcNow.ToString("o");
        }

        public static string ToJson(object value)
        {
            return JsonConvert.SerializeObject(value, JsonSettings);
        }

        public static T FromJson<T>(string json) where T : class
        {
            if (string.IsNullOrEmpty(json)) return null;
            try
            {
                return JsonConvert.DeserializeObject<T>(json, JsonSettings);
            }
            catch
            {
                return null;
            }
        }

        public static CompileRecord Compile = new CompileRecord();
        public static int RequestedCompileId;
        public static bool Compiling;

        public static void LoadPersistedState()
        {
            Compile = FromJson<CompileRecord>(SessionState.GetString(SessionCompile, "")) ?? new CompileRecord();
            if (Compile.state == "compiling")
            {
                Compile.state = "failed";
                Compile.finishedAt = Now();
                Compile.diagnostics.Add(new BridgeDiagnostic
                {
                    severity = "error",
                    message = "Unity reloaded before the compile finished. Run the compile again.",
                });
            }
            Compiling = false;
            RequestedCompileId = 0;
            SessionState.SetString(SessionCompile, ToJson(Compile));
        }

        public static void PersistCompile()
        {
            SessionState.SetString(SessionCompile, ToJson(Compile));
        }

        public static TestRunRecord TestRun;

        public static void LoadPersistedTestRun()
        {
            TestRun = FromJson<TestRunRecord>(SessionState.GetString(SessionTestRun, ""));
            if (TestRun != null && TestRun.state == "running")
            {
                TestRun.state = "error";
                TestRun.finishedAt = Now();
                TestRun.error = "Unity reloaded during the test run. Run PlayMode tests with domain reload disabled, or use EditMode tests.";
            }
        }

        public static void PersistTestRun()
        {
            if (TestRun != null) SessionState.SetString(SessionTestRun, ToJson(TestRun));
        }

        public static bool AutoStart
        {
            get { return EditorPrefs.GetBool(SessionAutoStart, true); }
            set { EditorPrefs.SetBool(SessionAutoStart, value); }
        }

        public static int PreferredPort
        {
            get { return EditorPrefs.GetInt(SessionPort, DefaultPort); }
            set { EditorPrefs.SetInt(SessionPort, value); }
        }
    }
}
