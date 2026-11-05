using System;
using System.Collections.Concurrent;
using System.Runtime.ExceptionServices;
using System.Threading;
using UnityEditor;

namespace UnityRail.Bridge
{
    /// <summary>
    /// Unity APIs are main-thread only. HTTP requests arrive on a background thread, so every route that
    /// touches Unity enqueues its work here and waits for the Editor update loop.
    /// </summary>
    public static class MainThread
    {
        private static readonly ConcurrentQueue<Action> Queue = new ConcurrentQueue<Action>();

        public static void Pump()
        {
            Action action;
            while (Queue.TryDequeue(out action))
            {
                try
                {
                    action();
                }
                catch (Exception error)
                {
                    UnityEngine.Debug.LogException(error);
                }
            }
        }

        public static T Run<T>(Func<T> function, int timeoutMs = 15000)
        {
            T result = default(T);
            Exception failure = null;
            using (ManualResetEventSlim done = new ManualResetEventSlim(false))
            {
                Queue.Enqueue(delegate
                {
                    try
                    {
                        result = function();
                    }
                    catch (Exception error)
                    {
                        failure = error;
                    }
                    finally
                    {
                        done.Set();
                    }
                });
                if (!done.Wait(timeoutMs))
                {
                    throw new TimeoutException("The Unity Editor did not process the request in time.");
                }
            }
            if (failure != null) ExceptionDispatchInfo.Capture(failure).Throw();
            return result;
        }

        public static void Run(Action action, int timeoutMs = 15000)
        {
            Run<object>(delegate
            {
                action();
                return null;
            }, timeoutMs);
        }

        public static void Post(Action action)
        {
            Queue.Enqueue(action);
        }
    }
}
