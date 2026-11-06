using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;
using UnityEngine;
using PackageInfo = UnityEditor.PackageManager.PackageInfo;

namespace UnityRail.Bridge
{
    /// <summary>
    /// The Package Manager can only be touched from the editor thread — even `Request.IsCompleted` throws
    /// off it. Requests are therefore started and polled inside `Tick()` (driven by the editor update
    /// loop) and the routes answer from a cache, with `pending` telling the caller to ask again.
    /// </summary>
    internal static class BridgePackageState
    {
        private static ListRequest Listing;
        private static Request Changing;
        private static List<object> Cached;
        private static string LastError;

        public static bool Pending
        {
            get { return Listing != null || Changing != null; }
        }

        public static void RequestList()
        {
            if (Listing != null) return;
            LastError = null;
            Listing = Client.List(false, true);
        }

        public static void RequestChange(string action, string identifier)
        {
            if (Changing != null) throw new BridgeHttpException(409, "A package change is already running.");
            LastError = null;
            Changing = action == "add" ? (Request)Client.Add(identifier) : Client.Remove(identifier);
            if (Changing == null) throw new BridgeHttpException(409, "Unity did not start the package request.");
        }

        public static void Tick()
        {
            if (Listing != null && Listing.IsCompleted)
            {
                if (Listing.Status == StatusCode.Success)
                {
                    List<PackageInfo> sorted = Listing.Result.ToList();
                    sorted.Sort((left, right) => string.CompareOrdinal(left.name, right.name));
                    Cached = sorted.Select((package) => (object)new
                    {
                        name = package.name,
                        displayName = package.displayName,
                        version = package.version,
                        source = package.source.ToString(),
                        direct = package.isDirectDependency,
                    }).ToList();
                }
                else
                {
                    LastError = Listing.Error != null ? Listing.Error.message : "Unity could not list packages.";
                }
                Listing = null;
            }
            if (Changing != null && Changing.IsCompleted)
            {
                if (Changing.Status != StatusCode.Success)
                {
                    LastError = Changing.Error != null ? Changing.Error.message : "Unity rejected the package change.";
                }
                Changing = null;
                // The list changes after an add/remove; refresh it on the next request.
                Cached = null;
            }
        }

        public static object Snapshot()
        {
            return new
            {
                packages = Cached ?? new List<object>(),
                pending = Pending,
                error = LastError,
            };
        }
    }

    public static partial class BridgeRoutes
    {
        private static BridgeResponse ListPackages(BridgeRequest request)
        {
            return MainThread.Run(delegate
            {
                if (!BridgePackageState.Pending) BridgePackageState.RequestList();
                BridgePackageState.Tick();
                return BridgeResponse.Json(BridgePackageState.Snapshot());
            }, 30000);
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
            try
            {
                MainThread.Run(delegate { BridgePackageState.RequestChange(action, identifier); }, 30000);
            }
            catch (BridgeHttpException error)
            {
                return BridgeResponse.Error(error.Status, "PACKAGE_FAILED", error.Message);
            }
            return BridgeResponse.Json(new { ok = true, accepted = true, id = identifier, action });
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
            string platform = (string)values["platform"];
            BuildTargetGroup? requested = null;
            if (!string.IsNullOrEmpty(platform))
            {
                BuildTargetGroup parsed;
                if (!BridgeSettings.TryGroup(platform, out parsed))
                {
                    return BridgeResponse.Error(400, "INVALID_PLATFORM", "Unknown platform: " + platform + ".");
                }
                requested = parsed;
            }
            return MainThread.Run(delegate
            {
                BuildTargetGroup group = requested ?? CurrentGroup();
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
