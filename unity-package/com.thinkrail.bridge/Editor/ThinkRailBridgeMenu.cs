using UnityEditor;
using UnityEngine;

namespace UnityRail.Bridge
{
    public static class ThinkRailBridgeMenu
    {
        [MenuItem("Tools/UnityRail/Start Unity Bridge", false, 1)]
        public static void StartBridge()
        {
            try
            {
                ThinkRailBridgeLifecycle.Start();
            }
            catch (System.Exception error)
            {
                EditorUtility.DisplayDialog("UnityRail Unity Bridge", error.Message, "OK");
            }
        }

        [MenuItem("Tools/UnityRail/Start Unity Bridge", true)]
        public static bool CanStartBridge()
        {
            return !BridgeRuntime.Running;
        }

        [MenuItem("Tools/UnityRail/Stop Unity Bridge", false, 2)]
        public static void StopBridge()
        {
            ThinkRailBridgeLifecycle.Stop();
        }

        [MenuItem("Tools/UnityRail/Stop Unity Bridge", true)]
        public static bool CanStopBridge()
        {
            return BridgeRuntime.Running;
        }

        [MenuItem("Tools/UnityRail/Bridge Status...", false, 3)]
        public static void ShowStatus()
        {
            string message;
            if (BridgeRuntime.Running && BridgeRuntime.Server != null)
            {
                message = "Running\n\n" +
                          "Endpoint: http://127.0.0.1:" + BridgeRuntime.Server.Port + "\n" +
                          "Project: " + BridgeState.ProjectPath + "\n" +
                          "Unity: " + Application.unityVersion + "\n" +
                          "Protocol: " + BridgeState.ProtocolVersion;
            }
            else
            {
                message = "Stopped\n\nProject: " + BridgeState.ProjectPath +
                          "\n\nStart it from Tools > UnityRail > Start Unity Bridge, or enable auto-start.";
            }
            EditorUtility.DisplayDialog("UnityRail Unity Bridge", message, "OK");
        }

        [MenuItem("Tools/UnityRail/Auto-start Bridge", false, 20)]
        public static void ToggleAutoStart()
        {
            BridgeState.AutoStart = !BridgeState.AutoStart;
            Menu.SetChecked("Tools/UnityRail/Auto-start Bridge", BridgeState.AutoStart);
        }

        [MenuItem("Tools/UnityRail/Auto-start Bridge", true)]
        public static bool ValidateAutoStart()
        {
            Menu.SetChecked("Tools/UnityRail/Auto-start Bridge", BridgeState.AutoStart);
            return true;
        }

        [MenuItem("Tools/UnityRail/Open Bridge Log Folder", false, 40)]
        public static void OpenLogFolder()
        {
            EditorUtility.RevealInFinder(Application.consoleLogPath);
        }
    }
}
