using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace UnityRail.Bridge
{
    [Serializable]
    public class BuildRecord
    {
        public string buildId;
        public string state = "running";
        public string target;
        public string outputPath;
        public string startedAt;
        public string finishedAt;
        public long durationMs;
        public ulong totalSize;
        public string result;
        public List<string> errors = new List<string>();
        public string error;
    }

    public static partial class BridgeRoutes
    {
        private static BuildRecord CurrentBuild;
        private static int BuildSequence;

        private static BridgeResponse StartBuild(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string targetName = (string)body["target"] ?? "windows";
            BuildTarget target;
            string targetError;
            if (!BridgeTargets.TryParse(targetName, out target, out targetError))
            {
                return BridgeResponse.Error(400, "INVALID_TARGET", targetError);
            }
            string[] scenes = StringArray(body["scenes"]);
            bool development = body["development"] != null && (bool)body["development"];
            string output = (string)body["outputPath"];
            if (string.IsNullOrEmpty(output))
            {
                output = Path.Combine("Builds", BridgeTargets.FolderName(targetName));
            }
            string projectRoot = BridgeState.ProjectPath;
            string absolute = Path.GetFullPath(Path.IsPathRooted(output) ? output : Path.Combine(projectRoot, output));
            if (!absolute.StartsWith(Path.GetFullPath(projectRoot), StringComparison.OrdinalIgnoreCase))
            {
                return BridgeResponse.Error(400, "INVALID_OUTPUT", "The build output must stay inside the project folder.");
            }
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
            {
                return BridgeResponse.Error(409, "BUSY", "Unity is compiling or importing. Retry when it is idle.");
            }
            if (CurrentBuild != null && CurrentBuild.state == "running")
            {
                return BridgeResponse.Error(409, "BUILD_RUNNING", "A build is already running.");
            }
            BuildRecord record = new BuildRecord
            {
                buildId = "build_" + (++BuildSequence) + "_" + DateTime.UtcNow.Ticks,
                state = "running",
                target = target.ToString(),
                outputPath = absolute,
                startedAt = BridgeState.Now(),
            };
            CurrentBuild = record;
            string[] scenePaths = scenes.Length > 0
                ? scenes
                : EditorBuildSettings.scenes.Where((scene) => scene.enabled).Select((scene) => scene.path).ToArray();
            if (scenePaths.Length == 0)
            {
                record.state = "failed";
                record.error = "No scenes are enabled in Build Settings.";
                record.finishedAt = BridgeState.Now();
                return BridgeResponse.Json(record);
            }
            MainThread.Post(delegate
            {
                Stopwatch watch = Stopwatch.StartNew();
                try
                {
                    BuildPlayerOptions options = new BuildPlayerOptions
                    {
                        scenes = scenePaths,
                        locationPathName = absolute,
                        target = target,
                        options = development ? BuildOptions.Development : BuildOptions.None,
                    };
                    BuildReport report = BuildPipeline.BuildPlayer(options);
                    record.state = report.summary.result == BuildResult.Succeeded ? "succeeded" : "failed";
                    record.result = report.summary.result.ToString();
                    record.totalSize = report.summary.totalSize;
                    record.outputPath = report.summary.outputPath;
                    record.errors = report.steps
                        .SelectMany((step) => step.messages)
                        .Where((message) => message.type == LogType.Error || message.type == LogType.Exception)
                        .Select((message) => message.content)
                        .Take(50)
                        .ToList();
                }
                catch (Exception error)
                {
                    record.state = "failed";
                    record.error = error.Message;
                }
                finally
                {
                    watch.Stop();
                    record.durationMs = watch.ElapsedMilliseconds;
                    record.finishedAt = BridgeState.Now();
                }
            });
            return BridgeResponse.Json(record);
        }

        private static BridgeResponse BuildStatus(BridgeRequest request)
        {
            string id;
            request.Query.TryGetValue("id", out id);
            BuildRecord record = CurrentBuild;
            if (record == null) return BridgeResponse.Error(404, "NO_BUILD", "No build has started.");
            if (!string.IsNullOrEmpty(id) && record.buildId != id)
            {
                return BridgeResponse.Error(404, "BUILD_NOT_FOUND", "Unknown build: " + id);
            }
            return BridgeResponse.Json(record);
        }
    }

    internal static class BridgeTargets
    {
        public static bool TryParse(string name, out BuildTarget target, out string error)
        {
            string key = (name ?? "").Trim().ToLowerInvariant();
            switch (key)
            {
                case "windows":
                case "win":
                case "win64":
                case "standalonewindows64":
                    target = BuildTarget.StandaloneWindows64;
                    error = null;
                    return true;
                case "windows32":
                case "standalonewindows":
                    target = BuildTarget.StandaloneWindows;
                    error = null;
                    return true;
                case "macos":
                case "osx":
                case "standaloneosx":
                    target = BuildTarget.StandaloneOSX;
                    error = null;
                    return true;
                case "linux":
                case "standalonelinux64":
                    target = BuildTarget.StandaloneLinux64;
                    error = null;
                    return true;
                case "android":
                    target = BuildTarget.Android;
                    error = null;
                    return true;
                case "ios":
                    target = BuildTarget.iOS;
                    error = null;
                    return true;
                case "webgl":
                    target = BuildTarget.WebGL;
                    error = null;
                    return true;
                default:
                    target = BuildTarget.StandaloneWindows64;
                    error = "Unknown build target: " + name + ".";
                    return false;
            }
        }

        public static string FolderName(string name)
        {
            return (name ?? "build").Trim().ToLowerInvariant().Replace(" ", "-");
        }
    }
}
