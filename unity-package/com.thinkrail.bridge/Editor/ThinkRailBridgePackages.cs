using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;
using UnityEditor.Build;
using PackageInfo = UnityEditor.PackageManager.PackageInfo;
using UnityEngine;

namespace UnityRail.Bridge
{
    public static partial class BridgeRoutes
    {
        private const int PackageTimeoutMs = 180000;

        private static BridgeResponse ListPackages(BridgeRequest request)
        {
            ListRequest list = Client.List(false, true);
            if (!WaitFor(list)) return BridgeResponse.Error(504, "PACKAGE_TIMEOUT", "Unity did not answer the package list in time.");
            if (list.Status != StatusCode.Success)
            {
                return BridgeResponse.Error(409, "PACKAGE_FAILED", list.Error != null ? list.Error.message : "Unity could not list packages.");
            }
            List<PackageInfo> sorted = list.Result.ToList();
            sorted.Sort((left, right) => string.CompareOrdinal(left.name, right.name));
            List<object> packages = new List<object>();
            foreach (PackageInfo package in sorted)
            {
                packages.Add(new
                {
                    name = package.name,
                    displayName = package.displayName,
                    version = package.version,
                    source = package.source.ToString(),
                    direct = package.isDirectDependency,
                });
            }
            return BridgeResponse.Json(new { packages });
        }

        private static BridgeResponse ChangePackage(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string action = ((string)body["action"] ?? "").Trim().ToLowerInvariant();
            string identifier = ((string)body["id"] ?? "").Trim();
            if (identifier.Length == 0)
            {
                return BridgeResponse.Error(400, "MISSING_ID", "packages requires an id (a package name, version or git/npm source).");
            }
            if (action != "add" && action != "remove")
            {
                return BridgeResponse.Error(400, "INVALID_ACTION", "action must be add or remove.");
            }
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
            {
                return BridgeResponse.Error(409, "BUSY", "Unity is compiling or importing. Retry when it is idle.");
            }
            Request change = action == "add" ? (Request)Client.Add(identifier) : Client.Remove(identifier);
            if (!WaitFor(change))
            {
                // A package change often triggers a domain reload before the request completes; the caller
                // treats this as "accepted, re-read packages later" rather than a failure.
                return BridgeResponse.Json(new { ok = true, accepted = true, id = identifier, action });
            }
            if (change.Status != StatusCode.Success)
            {
                return BridgeResponse.Error(409, "PACKAGE_FAILED", change.Error != null ? change.Error.message : "Unity rejected the package change.");
            }
            AddRequest added = change as AddRequest;
            return BridgeResponse.Json(new
            {
                ok = true,
                accepted = true,
                id = identifier,
                action,
                package = added != null
                    ? (object)new { name = added.Result.name, version = added.Result.version, source = added.Result.source.ToString() }
                    : null,
            });
        }

        private static bool WaitFor(Request request)
        {
            Stopwatch watch = Stopwatch.StartNew();
            while (!request.IsCompleted)
            {
                if (watch.ElapsedMilliseconds > PackageTimeoutMs) return false;
                Thread.Sleep(50);
            }
            return true;
        }
    }

    public static partial class BridgeRoutes
    {
        private static readonly string[] SettingKeys =
        {
            "productName",
            "companyName",
            "bundleVersion",
            "applicationIdentifier",
            "platform",
            "runInBackground",
            "defaultScreenWidth",
            "defaultScreenHeight",
            "fullscreenMode",
            "resizableWindow",
        };

        private static BridgeResponse ReadSettings(BridgeRequest request)
        {
            return MainThread.Run(delegate
            {
                return BridgeResponse.Json(new
                {
                    platform = CurrentGroup().ToString(),
                    values = CurrentSettings(CurrentGroup()),
                    allowed = SettingKeys,
                });
            }, 15000);
        }

        private static BridgeResponse WriteSettings(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            JObject values = body["settings"] as JObject ?? body;
            BuildTargetGroup group = CurrentGroup();
            string platform = (string)values["platform"];
            if (!string.IsNullOrEmpty(platform))
            {
                BuildTargetGroup parsed;
                if (!BridgeSettings.TryGroup(platform, out parsed))
                {
                    return BridgeResponse.Error(400, "INVALID_PLATFORM", "Unknown platform: " + platform + ".");
                }
                group = parsed;
            }
            return MainThread.Run(delegate
            {
                foreach (JProperty entry in values.Properties())
                {
                    if (entry.Name == "platform") continue;
                    if (!SettingKeys.Contains(entry.Name))
                    {
                        throw new BridgeHttpException(400, "Setting " + entry.Name + " is not writable from the bridge.");
                    }
                    BridgeSettings.Apply(entry.Name, entry.Value, group);
                }
                AssetDatabase.SaveAssets();
                return BridgeResponse.Json(new
                {
                    ok = true,
                    platform = group.ToString(),
                    values = CurrentSettings(group),
                });
            }, 30000);
        }

        private static BuildTargetGroup CurrentGroup()
        {
            BuildTarget target = EditorUserBuildSettings.activeBuildTarget;
            return BuildPipeline.GetBuildTargetGroup(target);
        }

        private static object CurrentSettings(BuildTargetGroup group)
        {
            return new
            {
                productName = PlayerSettings.productName,
                companyName = PlayerSettings.companyName,
                bundleVersion = PlayerSettings.bundleVersion,
                applicationIdentifier = PlayerSettings.GetApplicationIdentifier(NamedBuildTarget.FromBuildTargetGroup(group)),
                runInBackground = PlayerSettings.runInBackground,
                defaultScreenWidth = PlayerSettings.defaultScreenWidth,
                defaultScreenHeight = PlayerSettings.defaultScreenHeight,
                fullscreenMode = PlayerSettings.fullScreenMode.ToString(),
                resizableWindow = PlayerSettings.resizableWindow,
            };
        }
    }

    internal static class BridgeSettings
    {
        public static bool TryGroup(string name, out BuildTargetGroup group)
        {
            switch ((name ?? "").Trim().ToLowerInvariant())
            {
                case "standalone":
                case "windows":
                case "macos":
                case "linux":
                    group = BuildTargetGroup.Standalone;
                    return true;
                case "android":
                    group = BuildTargetGroup.Android;
                    return true;
                case "ios":
                    group = BuildTargetGroup.iOS;
                    return true;
                case "webgl":
                    group = BuildTargetGroup.WebGL;
                    return true;
                default:
                    group = BuildTargetGroup.Standalone;
                    return false;
            }
        }

        public static void Apply(string key, JToken value, BuildTargetGroup group)
        {
            switch (key)
            {
                case "productName":
                    PlayerSettings.productName = (string)value;
                    return;
                case "companyName":
                    PlayerSettings.companyName = (string)value;
                    return;
                case "bundleVersion":
                    PlayerSettings.bundleVersion = (string)value;
                    return;
                case "applicationIdentifier":
                    PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.FromBuildTargetGroup(group), (string)value);
                    return;
                case "runInBackground":
                    PlayerSettings.runInBackground = (bool)value;
                    return;
                case "defaultScreenWidth":
                    PlayerSettings.defaultScreenWidth = (int)value;
                    return;
                case "defaultScreenHeight":
                    PlayerSettings.defaultScreenHeight = (int)value;
                    return;
                case "fullscreenMode":
                    FullScreenMode mode;
                    if (!Enum.TryParse((string)value, true, out mode)) throw new BridgeHttpException(400, "Unknown fullscreen mode: " + value + ".");
                    PlayerSettings.fullScreenMode = mode;
                    return;
                case "resizableWindow":
                    PlayerSettings.resizableWindow = (bool)value;
                    return;
            }
        }
    }
}
