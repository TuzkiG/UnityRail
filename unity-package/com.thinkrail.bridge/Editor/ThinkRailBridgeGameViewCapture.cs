using System;
using System.Collections;
using System.Threading;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace UnityRail.Bridge
{
    /** One in-flight Game View capture. The HTTP thread waits on it; the coroutine completes it on the
     * main thread at the end of a rendered frame, which is the only point ScreenCapture accepts. */
    public sealed class GameViewCaptureRequest
    {
        private readonly ManualResetEventSlim _done = new ManualResetEventSlim(false);
        private byte[] _png;
        private string _error;

        public readonly int Width;

        public GameViewCaptureRequest(int width)
        {
            Width = width;
        }

        public void Complete(byte[] png)
        {
            _png = png;
            _done.Set();
        }

        public void Fail(string error)
        {
            _error = error;
            _done.Set();
        }

        /** Blocks the calling (non-Unity) thread only. */
        public byte[] Wait(int timeoutMs)
        {
            if (!_done.Wait(timeoutMs)) return null;
            if (_png != null) return _png;
            if (!string.IsNullOrEmpty(_error)) Debug.LogWarning("[UnityRail] Game View capture: " + _error);
            return null;
        }
    }

    internal sealed class GameViewCaptureBehaviour : MonoBehaviour
    {
        public void CaptureNextFrame(GameViewCaptureRequest request)
        {
            StartCoroutine(CaptureRoutine(request));
        }

        private static IEnumerator CaptureRoutine(GameViewCaptureRequest request)
        {
            // ScreenCapture is only valid once the frame has finished rendering; called from an editor
            // update tick it logs "Was method called before the 'end of frame' state was reached?" and
            // produces nothing.
            yield return new WaitForEndOfFrame();
            Texture2D texture = null;
            try
            {
                texture = ScreenCapture.CaptureScreenshotAsTexture();
            }
            catch (Exception error)
            {
                request.Fail(error.Message);
                yield break;
            }
            if (texture == null)
            {
                request.Fail("Unity returned no Game View frame.");
                yield break;
            }
            try
            {
                request.Complete(ScreenshotCapture.EncodeScaled(texture, request.Width));
            }
            finally
            {
                Object.Destroy(texture);
            }
        }
    }

    public static class GameViewCapture
    {
        private const int CAPTURE_TIMEOUT_MS = 8_000;
        private static GameViewCaptureBehaviour _behaviour;

        /**
         * Queue a Game View capture and return the PNG, or null when no frame could be read.
         *
         * Must be called from the HTTP thread, never from inside a main-thread action: it waits for the
         * Unity side to finish a frame, and blocking the main thread would prevent exactly that.
         */
        public static byte[] TryCapture(int width)
        {
            GameViewCaptureRequest request = new GameViewCaptureRequest(width);
            MainThread.Post(delegate
            {
                if (!EditorApplication.isPlaying)
                {
                    request.Fail("Play Mode is not running.");
                    return;
                }
                GameViewCaptureBehaviour behaviour = Host();
                behaviour.CaptureNextFrame(request);
            });
            return request.Wait(CAPTURE_TIMEOUT_MS);
        }

        private static GameViewCaptureBehaviour Host()
        {
            if (_behaviour != null) return _behaviour;
            GameObject host = new GameObject("UnityRail Game View Capture");
            host.hideFlags = HideFlags.HideAndDontSave;
            Object.DontDestroyOnLoad(host);
            _behaviour = host.AddComponent<GameViewCaptureBehaviour>();
            return _behaviour;
        }
    }
}
