using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace UnityRail.Bridge
{
    public class BridgeHttpException : Exception
    {
        public readonly int Status;

        public BridgeHttpException(int status, string message) : base(message)
        {
            Status = status;
        }
    }

    public static partial class BridgeRoutes
    {
        public static BridgeResponse Handle(BridgeRequest request)
        {
            try
            {
                string key = request.Method + " " + request.Path;
                switch (key)
                {
                    case "GET /v1/health":
                        return BridgeResponse.Json(new { ok = true, protocolVersion = BridgeState.ProtocolVersion });
                    case "GET /v1/status":
                        return MainThread.Run(delegate { return BridgeResponse.Json(StatusObject()); });
                    case "POST /v1/compile":
                        return Compile(request);
                    case "GET /v1/console":
                        return Console(request);
                    case "DELETE /v1/console":
                        ConsoleBuffer.Clear();
                        return BridgeResponse.Json(new { ok = true });
                    case "POST /v1/playmode":
                        return PlayMode(request);
                    case "GET /v1/screenshot":
                        return Screenshot(request);
                    case "POST /v1/tests":
                        return StartTests(request);
                    case "GET /v1/tests/status":
                        return TestStatus(request);
                    case "GET /v1/hierarchy":
                        return Hierarchy(request);
                    case "GET /v1/inspect":
                        return Inspect(request);
                    case "GET /v1/find":
                        return Find(request);
                    case "POST /v1/open":
                        return Open(request);
                    case "POST /v1/select":
                        return Select(request);
                    case "POST /v1/scene/object":
                        return CreateObject(request);
                    case "DELETE /v1/scene/object":
                        return DeleteObject(request);
                    case "POST /v1/component":
                        return AddComponent(request);
                    case "DELETE /v1/component":
                        return RemoveComponent(request);
                    case "PATCH /v1/property":
                        return SetProperty(request);
                    case "POST /v1/scene/save":
                        return SaveScene(request);
                    case "POST /v1/undo":
                        return PerformUndo(request);
                    case "POST /v1/menu":
                        return ExecuteMenu(request);
                    case "POST /v1/editor/quit":
                        return QuitEditor(request);
                    case "GET /v1/profiler":
                        return ProfilerSnapshot(request);
                    case "POST /v1/input":
                        return QueueInput(request);
                    case "POST /v1/build":
                        return StartBuild(request);
                    case "GET /v1/build/status":
                        return BuildStatus(request);
                    case "GET /v1/packages":
                        return ListPackages(request);
                    case "POST /v1/packages":
                        return ChangePackage(request);
                    case "GET /v1/settings":
                        return ReadSettings(request);
                    case "POST /v1/settings":
                        return WriteSettings(request);
                    default:
                        return BridgeResponse.Error(404, "NOT_FOUND", "Unknown bridge route: " + key);
                }
            }
            catch (BridgeHttpException error)
            {
                return BridgeResponse.Error(error.Status, "REQUEST_FAILED", error.Message);
            }
            catch (Exception error)
            {
                return BridgeResponse.Error(500, "INTERNAL", error.Message);
            }
        }

        private static object StatusObject()
        {
            List<object> selection = new List<object>();
            foreach (Object selected in Selection.objects)
            {
                if (selected == null || selection.Count >= 20) continue;
                GameObject gameObject = selected as GameObject;
                string path = gameObject != null ? HierarchyUtil.PathOf(gameObject) : AssetDatabase.GetAssetPath(selected);
                selection.Add(new
                {
                    name = selected.name,
                    path,
                    type = selected.GetType().Name,
                    instanceId = selected.GetInstanceID(),
                });
            }
            Scene scene = SceneManager.GetActiveScene();
            CompileRecord compile = BridgeState.Compile;
            object lastCompile = compile != null && compile.state != "idle" ? (object)compile : null;
            return new
            {
                protocolVersion = BridgeState.ProtocolVersion,
                port = BridgeRuntime.Server != null ? BridgeRuntime.Server.Port : BridgeState.PreferredPort,
                projectPath = BridgeState.ProjectPath,
                unityVersion = Application.unityVersion,
                bridgeStartedAt = BridgeRuntime.StartedAt,
                isPlaying = EditorApplication.isPlaying,
                isPaused = EditorApplication.isPaused,
                isCompiling = EditorApplication.isCompiling || BridgeState.Compiling,
                isUpdating = EditorApplication.isUpdating,
                applicationPath = EditorApplication.applicationPath,
                platform = Application.platform.ToString(),
                activeScene = string.IsNullOrEmpty(scene.path) ? null : scene.path,
                selection,
                lastCompile,
                consoleSeq = ConsoleBuffer.CurrentSeq,
            };
        }

        private static BridgeResponse Compile(BridgeRequest request)
        {
            return MainThread.Run(delegate
            {
                if (BridgeState.Compiling || BridgeState.Compile.state == "compiling")
                {
                    return BridgeResponse.Json(new
                    {
                        compileId = BridgeState.Compile.id,
                        state = "compiling",
                    });
                }
                bool force = false;
                try
                {
                    JObject body = ParseBody(request);
                    force = body["force"] != null && (bool)body["force"];
                }
                catch (BridgeHttpException)
                {
                    // A bodyless or empty compile request is a plain recompile.
                }
                bool alreadyCompiling = EditorApplication.isCompiling;
                int id = Math.Max(BridgeState.Compile.id, BridgeState.RequestedCompileId) + 1;
                BridgeState.Compile = new CompileRecord
                {
                    id = id,
                    state = "compiling",
                    startedAt = BridgeState.Now(),
                };
                BridgeState.Compiling = true;
                BridgeState.RequestedCompileId = id;
                BridgeState.PersistCompile();
                try
                {
                    if (!alreadyCompiling)
                    {
                        if (force)
                        {
#if UNITY_6000_0_OR_NEWER
                            CompilationPipeline.RequestScriptCompilation(new RequestScriptCompilationOptions { CleanScriptCompilation = true });
#else
                            // 2022.3 has no clean-compilation option; a plain request is the honest fallback.
                            CompilationPipeline.RequestScriptCompilation();
#endif
                        }
                        else CompilationPipeline.RequestScriptCompilation();
                    }
                }
                catch (Exception error)
                {
                    BridgeState.Compiling = false;
                    BridgeState.Compile.state = "failed";
                    BridgeState.Compile.finishedAt = BridgeState.Now();
                    BridgeState.Compile.diagnostics.Add(new BridgeDiagnostic
                    {
                        severity = "error",
                        message = error.Message,
                    });
                    BridgeState.PersistCompile();
                    throw new BridgeHttpException(409, error.Message);
                }
                return BridgeResponse.Json(new { compileId = id, state = "compiling" });
            }, 30000);
        }

        private static BridgeResponse Console(BridgeRequest request)
        {
            long since = ParseLong(request.Query, "since", 0);
            int limit = (int)Math.Min(1000, ParseLong(request.Query, "limit", 200));
            HashSet<string> levels = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string levelQuery;
            if (request.Query.TryGetValue("levels", out levelQuery) && !string.IsNullOrEmpty(levelQuery))
            {
                foreach (string level in levelQuery.Split(','))
                {
                    if (!string.IsNullOrWhiteSpace(level)) levels.Add(level.Trim());
                }
            }
            List<ConsoleEntry> entries = ConsoleBuffer.Read(since, limit, levels);
            return BridgeResponse.Json(new
            {
                entries,
                nextSeq = ConsoleBuffer.CurrentSeq,
                dropped = ConsoleBuffer.Dropped,
            });
        }

        private static BridgeResponse PlayMode(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string action = (string)body["action"];
            if (string.IsNullOrEmpty(action))
            {
                throw new BridgeHttpException(400, "Missing playmode action.");
            }
            return MainThread.Run(delegate
            {
                switch (action)
                {
                    case "play":
                        if (EditorApplication.isCompiling)
                            throw new BridgeHttpException(409, "Unity is compiling; wait for the compile to finish.");
                        if (!EditorApplication.isPlaying)
                        {
                            // Entering Play Mode reloads the domain, so the transition is scheduled a couple of
                            // editor ticks out: the HTTP reply flushes first and the request survives the reload.
                            ThinkRailBridgeLifecycle.RequestPlay();
                        }
                        break;
                    case "stop":
                        if (EditorApplication.isPlaying) EditorApplication.isPlaying = false;
                        break;
                    case "pause":
                        if (!EditorApplication.isPlaying)
                            throw new BridgeHttpException(409, "Play Mode is not running.");
                        EditorApplication.isPaused = true;
                        break;
                    case "resume":
                        if (!EditorApplication.isPlaying)
                            throw new BridgeHttpException(409, "Play Mode is not running.");
                        EditorApplication.isPaused = false;
                        break;
                    case "step":
                        if (!EditorApplication.isPlaying || !EditorApplication.isPaused)
                            throw new BridgeHttpException(409, "Step requires Play Mode to be paused.");
                        EditorApplication.Step();
                        break;
                    default:
                        throw new BridgeHttpException(400, "Unknown playmode action: " + action);
                }
                return BridgeResponse.Json(StatusObject());
            });
        }

        private static BridgeResponse Screenshot(BridgeRequest request)
        {
            string view = "game";
            string viewQuery;
            if (request.Query.TryGetValue("view", out viewQuery) && !string.IsNullOrEmpty(viewQuery))
            {
                view = viewQuery == "scene" ? "scene" : "game";
            }
            int width = (int)ParseLong(request.Query, "width", 0);
            try
            {
                // A running game is captured from its own rendered frame (the HTTP thread waits; the Unity
                // main thread keeps pumping). Everything else renders a camera on the main thread.
                if (view == "game")
                {
                    byte[] frame = GameViewCapture.TryCapture(width);
                    if (frame != null) return BridgeResponse.Png(frame);
                }
                byte[] png = MainThread.Run(delegate { return ScreenshotCapture.Capture(view, width); }, 60000);
                return BridgeResponse.Png(png);
            }
            catch (Exception error)
            {
                return BridgeResponse.Error(409, "SCREENSHOT_FAILED", error.Message);
            }
        }

        private static BridgeResponse StartTests(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string mode = ((string)body["mode"] ?? "edit") == "play" ? "play" : "edit";
            string filter = (string)body["filter"];
            return MainThread.Run(delegate
            {
                try
                {
                    TestRunRecord record = UnityRailTests.Start(mode, filter);
                    return BridgeResponse.Json(new { runId = record.runId, state = record.state });
                }
                catch (Exception error)
                {
                    throw new BridgeHttpException(409, error.Message);
                }
            }, 60000);
        }

        private static BridgeResponse TestStatus(BridgeRequest request)
        {
            string id;
            request.Query.TryGetValue("id", out id);
            TestRunRecord record = BridgeState.TestRun;
            if (record == null) return BridgeResponse.Error(404, "NO_TEST_RUN", "No test run has started.");
            if (!string.IsNullOrEmpty(id) && record.runId != id)
            {
                return BridgeResponse.Error(404, "TEST_RUN_NOT_FOUND", "Unknown test run: " + id);
            }
            return BridgeResponse.Json(record);
        }

        private static BridgeResponse Hierarchy(BridgeRequest request)
        {
            string selector = null;
            request.Query.TryGetValue("scene", out selector);
            return MainThread.Run(delegate
            {
                return BridgeResponse.Json(HierarchyUtil.Snapshot(selector));
            }, 30000);
        }

        private static BridgeResponse Inspect(BridgeRequest request)
        {
            string path;
            if (!request.Query.TryGetValue("path", out path) || string.IsNullOrEmpty(path))
            {
                return BridgeResponse.Error(400, "MISSING_PATH", "inspect requires a path.");
            }
            try
            {
                return MainThread.Run(delegate
                {
                    return BridgeResponse.Json(HierarchyUtil.Inspect(path));
                }, 30000);
            }
            catch (Exception error)
            {
                return BridgeResponse.Error(404, "NOT_FOUND", error.Message);
            }
        }

        private static BridgeResponse Find(BridgeRequest request)
        {
            string query;
            if (!request.Query.TryGetValue("query", out query) || string.IsNullOrEmpty(query))
            {
                return BridgeResponse.Error(400, "MISSING_QUERY", "find requires a query.");
            }
            string type;
            request.Query.TryGetValue("type", out type);
            int limit = (int)Math.Min(100, ParseLong(request.Query, "limit", 50));
            return MainThread.Run(delegate
            {
                string search = string.IsNullOrEmpty(type) ? query : query + " t:" + type;
                string[] guids = AssetDatabase.FindAssets(search, new[] { "Assets", "Packages" });
                List<object> results = new List<object>();
                foreach (string guid in guids)
                {
                    if (results.Count >= limit) break;
                    string path = AssetDatabase.GUIDToAssetPath(guid);
                    if (string.IsNullOrEmpty(path) || AssetDatabase.IsValidFolder(path)) continue;
                    Type assetType = AssetDatabase.GetMainAssetTypeAtPath(path);
                    results.Add(new
                    {
                        name = Path.GetFileNameWithoutExtension(path),
                        path,
                        guid,
                        type = assetType != null ? assetType.Name : "Asset",
                    });
                }
                return BridgeResponse.Json(results);
            }, 30000);
        }

        private static BridgeResponse Open(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string path = (string)body["path"];
            if (string.IsNullOrEmpty(path))
            {
                return BridgeResponse.Error(400, "MISSING_PATH", "open requires a path.");
            }
            if (!path.StartsWith("Assets/") && !path.StartsWith("Packages/"))
            {
                return BridgeResponse.Error(400, "INVALID_PATH", "Only project-relative Assets/ or Packages/ paths can be opened.");
            }
            if (path.Contains(".."))
            {
                return BridgeResponse.Error(400, "INVALID_PATH", "The path must not contain '..'.");
            }
            return MainThread.Run(delegate
            {
                if (path.EndsWith(".unity"))
                {
                    Scene active = SceneManager.GetActiveScene();
                    if (active.IsValid() && active.isDirty)
                    {
                        throw new BridgeHttpException(409, "The open scene has unsaved changes. Save or discard them in Unity first.");
                    }
                    Scene opened = EditorSceneManager.OpenScene(path, OpenSceneMode.Single);
                    if (!opened.IsValid()) throw new BridgeHttpException(404, "Could not open scene " + path + ".");
                    return BridgeResponse.Json(new { ok = true, path });
                }
                Object asset = AssetDatabase.LoadAssetAtPath<Object>(path);
                if (asset == null) throw new BridgeHttpException(404, "No asset at " + path + ".");
                AssetDatabase.OpenAsset(asset);
                return BridgeResponse.Json(new { ok = true, path });
            }, 60000);
        }

        private static BridgeResponse Select(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string path = (string)body["path"];
            if (string.IsNullOrEmpty(path))
            {
                return BridgeResponse.Error(400, "MISSING_PATH", "select requires a path.");
            }
            return MainThread.Run(delegate
            {
                GameObject gameObject = HierarchyUtil.FindByPath(path);
                if (gameObject != null)
                {
                    Selection.activeGameObject = gameObject;
                    EditorGUIUtility.PingObject(gameObject);
                    return BridgeResponse.Json(new { ok = true });
                }
                Object asset = AssetDatabase.LoadAssetAtPath<Object>(path);
                if (asset == null) throw new BridgeHttpException(404, "No GameObject or asset at " + path + ".");
                Selection.activeObject = asset;
                EditorGUIUtility.PingObject(asset);
                return BridgeResponse.Json(new { ok = true });
            });
        }

        private static JObject ParseBody(BridgeRequest request)
        {
            if (string.IsNullOrEmpty(request.Body))
            {
                throw new BridgeHttpException(400, "Missing JSON body.");
            }
            try
            {
                return JObject.Parse(request.Body);
            }
            catch (Exception error)
            {
                throw new BridgeHttpException(400, "Invalid JSON body: " + error.Message);
            }
        }

        private static long ParseLong(Dictionary<string, string> query, string key, long fallback)
        {
            string raw;
            if (!query.TryGetValue(key, out raw) || string.IsNullOrEmpty(raw)) return fallback;
            long value;
            return long.TryParse(raw, out value) ? value : fallback;
        }
    }
}
