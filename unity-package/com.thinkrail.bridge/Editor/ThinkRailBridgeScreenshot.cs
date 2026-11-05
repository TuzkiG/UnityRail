using System;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace UnityRail.Bridge
{
    public static class ScreenshotCapture
    {
        public static byte[] Capture(string view, int width)
        {
            if (view == "scene")
            {
                SceneView sceneView = SceneView.lastActiveSceneView;
                if (sceneView == null || sceneView.camera == null)
                {
                    throw new Exception("No Scene View is open in the Editor.");
                }
                return RenderCamera(sceneView.camera, width);
            }

            // Game View frames are captured by the route at the end of a rendered frame; reaching here means
            // Play Mode is not rendering, so render the game camera instead.
            Camera camera = ActiveCamera();
            if (camera == null)
            {
                throw new Exception(
                    EditorApplication.isPlaying
                        ? "No active camera is rendering. Add an enabled Camera to the scene, then capture again."
                        : "No camera is available. Enter Play Mode or add a Camera to the open scene.");
            }
            return RenderCamera(camera, width);
        }

        /** The camera the player most likely sees: Camera.main, else the enabled camera drawn last. */
        private static Camera ActiveCamera()
        {
            Camera main = Camera.main;
            if (main != null && main.isActiveAndEnabled) return main;
            Camera best = null;
            Camera[] cameras = Object.FindObjectsOfType<Camera>();
            foreach (Camera candidate in cameras)
            {
                if (!candidate.isActiveAndEnabled) continue;
                if (best == null || candidate.depth > best.depth) best = candidate;
            }
            return best;
        }

        internal static byte[] RenderCamera(Camera camera, int width)
        {
            int targetWidth = width > 0 ? Math.Min(width, 3840) : Math.Max(1, camera.pixelWidth);
            int targetHeight = Math.Max(1, Mathf.RoundToInt(targetWidth * (float)camera.pixelHeight / Math.Max(1, camera.pixelWidth)));
            RenderTexture render = RenderTexture.GetTemporary(
                targetWidth, targetHeight, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Default);
            RenderTexture previousTarget = camera.targetTexture;
            RenderTexture previousActive = RenderTexture.active;
            try
            {
                camera.targetTexture = render;
                camera.Render();
                RenderTexture.active = render;
                Texture2D texture = new Texture2D(targetWidth, targetHeight, TextureFormat.RGBA32, false);
                try
                {
                    texture.ReadPixels(new Rect(0, 0, targetWidth, targetHeight), 0, 0);
                    texture.Apply(false, false);
                    return texture.EncodeToPNG();
                }
                finally
                {
                    Object.DestroyImmediate(texture);
                }
            }
            finally
            {
                camera.targetTexture = previousTarget;
                RenderTexture.active = previousActive;
                RenderTexture.ReleaseTemporary(render);
            }
        }

        internal static byte[] EncodeScaled(Texture source, int width)
        {
            int targetWidth = width > 0 ? Math.Min(width, 3840) : source.width;
            int targetHeight = Math.Max(1, Mathf.RoundToInt(targetWidth * (float)source.height / Math.Max(1, source.width)));
            RenderTexture render = RenderTexture.GetTemporary(
                targetWidth, targetHeight, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Default);
            RenderTexture previousActive = RenderTexture.active;
            try
            {
                Graphics.Blit(source, render);
                RenderTexture.active = render;
                Texture2D texture = new Texture2D(targetWidth, targetHeight, TextureFormat.RGBA32, false);
                try
                {
                    texture.ReadPixels(new Rect(0, 0, targetWidth, targetHeight), 0, 0);
                    texture.Apply(false, false);
                    return texture.EncodeToPNG();
                }
                finally
                {
                    Object.DestroyImmediate(texture);
                }
            }
            finally
            {
                RenderTexture.active = previousActive;
                RenderTexture.ReleaseTemporary(render);
            }
        }
    }
}
