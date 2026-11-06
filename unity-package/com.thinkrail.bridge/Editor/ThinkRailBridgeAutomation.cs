using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using Newtonsoft.Json.Linq;
using Unity.Profiling;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace UnityRail.Bridge
{
    /// <summary>
    /// Editor-level control: menu items, profiler markers, synthesized input and quitting. Menu execution
    /// and quitting are the two irreversible operations, so they refuse while Unity is busy and quitting
    /// refuses to discard unsaved scenes without an explicit flag.
    /// </summary>
    public static partial class BridgeRoutes
    {
        private static Timer ExitTimer;
        private static readonly HashSet<string> HeldKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        private static BridgeResponse ExecuteMenu(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string item = (string)body["item"];
            if (string.IsNullOrEmpty(item)) return BridgeResponse.Error(400, "MISSING_ITEM", "menu requires an item path.");
            return MainThread.Run(delegate
            {
                if (EditorApplication.isCompiling || EditorApplication.isUpdating)
                {
                    throw new BridgeHttpException(409, "Unity is busy compiling or importing. Retry when it is idle.");
                }
                bool executed = EditorApplication.ExecuteMenuItem(item);
                if (!executed)
                {
                    throw new BridgeHttpException(404, "No enabled menu item named " + item + ".");
                }
                return BridgeResponse.Json(new { ok = true, item });
            }, 60000);
        }

        private static BridgeResponse ProfilerSnapshot(BridgeRequest request)
        {
            return MainThread.Run(delegate
            {
                List<object> markers = new List<object>();
                Probe(markers, ProfilerCategory.Render, "Draw Calls Count", "count");
                Probe(markers, ProfilerCategory.Render, "Batches Count", "count");
                Probe(markers, ProfilerCategory.Render, "Triangles Count", "count");
                Probe(markers, ProfilerCategory.Memory, "Total Used Memory", "bytes");
                return BridgeResponse.Json(new
                {
                    frame = Time.frameCount,
                    isPlaying = EditorApplication.isPlaying,
                    markers,
                });
            }, 15000);
        }

        private static void Probe(List<object> markers, ProfilerCategory category, string name, string unit)
        {
            try
            {
                using (ProfilerRecorder recorder = ProfilerRecorder.StartNew(category, name))
                {
                    if (!recorder.Valid) return;
                    markers.Add(new { name, category = category.Name, unit, value = recorder.LastValue });
                }
            }
            catch
            {
                // A marker this Unity version does not expose is simply absent from the snapshot.
            }
        }

        private static BridgeResponse QueueInput(BridgeRequest request)
        {
            JObject body = string.IsNullOrEmpty(request.Body) ? new JObject() : ParseBody(request);
            string[] keys = StringArray(body["keys"]);
            bool releaseAll = body["releaseAll"] != null && (bool)body["releaseAll"];
            return MainThread.Run(delegate
            {
                if (!EditorApplication.isPlaying)
                {
                    throw new BridgeHttpException(409, "Input can only be synthesized while Play Mode is running.");
                }
                if (releaseAll) HeldKeys.Clear();
                else
                {
                    foreach (string key in keys) HeldKeys.Add(key);
                }
                try
                {
                    BridgeInput.Apply(HeldKeys);
                }
                catch (BridgeHttpException)
                {
                    throw;
                }
                catch (Exception error)
                {
                    throw new BridgeHttpException(409, error.Message);
                }
                return BridgeResponse.Json(new { ok = true, keys = HeldKeys.ToArray(), isPlaying = true });
            }, 15000);
        }

        private static BridgeResponse QuitEditor(BridgeRequest request)
        {
            JObject body = string.IsNullOrEmpty(request.Body) ? new JObject() : ParseBody(request);
            bool save = body["save"] != null && (bool)body["save"];
            bool discard = body["discard"] != null && (bool)body["discard"];
            return MainThread.Run(delegate
            {
                if (EditorApplication.isPlaying)
                {
                    throw new BridgeHttpException(409, "Stop Play Mode before quitting the Editor.");
                }
                if (!save && !discard && HasDirtyScenes())
                {
                    throw new BridgeHttpException(409, "The open scene has unsaved changes. Pass save:true or discard:true.");
                }
                if (save) EditorSceneManager.SaveOpenScenes();
                ScheduleExit();
                return BridgeResponse.Json(new { ok = true, quitting = true, saved = save });
            }, 30000);
        }

        private static bool HasDirtyScenes()
        {
            for (int index = 0; index < UnityEngine.SceneManagement.SceneManager.sceneCount; index += 1)
            {
                UnityEngine.SceneManagement.Scene scene = UnityEngine.SceneManagement.SceneManager.GetSceneAt(index);
                if (scene.IsValid() && scene.isDirty) return true;
            }
            PrefabStage stage = PrefabStageUtility.GetCurrentPrefabStage();
            return stage != null && stage.scene.IsValid() && stage.scene.isDirty;
        }

        private static void ScheduleExit()
        {
            if (ExitTimer != null) return;
            ExitTimer = new Timer(delegate
            {
                MainThread.Post(delegate { EditorApplication.Exit(0); });
            }, null, 750, Timeout.Infinite);
        }
    }

    /// <summary>
    /// Synthesizes input through the Input System's own device state queue. The bridge assembly has no
    /// reference to the package (a project may use the legacy input manager), so every type is resolved
    /// by reflection and a missing package is a clear 409 rather than a compile-time dependency.
    /// </summary>
    internal static class BridgeInput
    {
        public static void Apply(IEnumerable<string> keys)
        {
            Type inputSystem = FindType("UnityEngine.InputSystem.InputSystem");
            Type keyboardType = FindType("UnityEngine.InputSystem.Keyboard");
            Type keyType = FindType("UnityEngine.InputSystem.Key");
            Type stateType = FindType("UnityEngine.InputSystem.LowLevel.KeyboardState");
            if (inputSystem == null || keyboardType == null || keyType == null || stateType == null)
            {
                throw new BridgeHttpException(409, "The Input System package is not installed in this project.");
            }
            object keyboard = keyboardType.GetProperty("current", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
            if (keyboard == null)
            {
                throw new BridgeHttpException(409, "No keyboard device is available in the Editor.");
            }
            string[] names = keys.ToArray();
            Array values = Array.CreateInstance(keyType, names.Length);
            for (int index = 0; index < names.Length; index += 1)
            {
                object parsed;
                try
                {
                    parsed = Enum.Parse(keyType, names[index], true);
                }
                catch
                {
                    throw new BridgeHttpException(400, "Unknown key: " + names[index] + ".");
                }
                values.SetValue(parsed, index);
            }
            ConstructorInfo constructor = stateType.GetConstructor(new[] { keyType.MakeArrayType() });
            if (constructor == null) throw new BridgeHttpException(409, "KeyboardState cannot be constructed.");
            object state = constructor.Invoke(new object[] { values });
            MethodInfo[] methods = inputSystem.GetMethods(BindingFlags.Public | BindingFlags.Static);
            MethodInfo queue = methods.FirstOrDefault((method) =>
                    method.Name == "QueueStateEvent" &&
                    method.IsGenericMethodDefinition &&
                    method.GetParameters().Length == 3) ??
                methods.FirstOrDefault((method) =>
                    method.Name == "QueueStateEvent" &&
                    method.IsGenericMethodDefinition &&
                    method.GetParameters().Length == 2);
            if (queue == null) throw new BridgeHttpException(409, "InputSystem.QueueStateEvent was not found.");
            object[] arguments = queue.GetParameters().Length == 3
                ? new object[] { keyboard, state, -1.0 }
                : new object[] { keyboard, state };
            queue.MakeGenericMethod(stateType).Invoke(null, arguments);
        }

        private static Type FindType(string fullName)
        {
            Type direct = Type.GetType(fullName + ", Unity.InputSystem");
            if (direct != null) return direct;
            foreach (Assembly assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type found = assembly.GetType(fullName, false);
                if (found != null) return found;
            }
            return null;
        }
    }
}
