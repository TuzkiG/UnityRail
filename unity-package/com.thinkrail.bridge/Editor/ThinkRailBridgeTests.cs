using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;

namespace UnityRail.Bridge
{
    public static class UnityRailTests
    {
        private static TestRunnerApi _api;
        private static UnityRailTestCallbacks _callbacks;

        public static TestRunRecord Start(string mode, string filterName)
        {
            if (BridgeState.TestRun != null && BridgeState.TestRun.state == "running")
            {
                throw new Exception("A Unity test run is already in progress.");
            }
            TestMode testMode = mode == "play" ? TestMode.PlayMode : TestMode.EditMode;
            TestRunRecord record = new TestRunRecord
            {
                runId = Guid.NewGuid().ToString("N"),
                mode = mode == "play" ? "play" : "edit",
                state = "running",
                startedAt = BridgeState.Now(),
            };
            BridgeState.TestRun = record;
            BridgeState.PersistTestRun();

            if (_api == null)
            {
                _api = ScriptableObject.CreateInstance<TestRunnerApi>();
                _api.hideFlags = HideFlags.HideAndDontSave;
            }
            _callbacks = new UnityRailTestCallbacks(record.runId);
            _api.RegisterCallbacks(_callbacks);

            Filter filter = new Filter();
            filter.testMode = testMode;
            if (!string.IsNullOrEmpty(filterName))
            {
                filter.testNames = new[] { filterName };
            }
            _api.Execute(new ExecutionSettings(filter));
            return record;
        }
    }

    internal class UnityRailTestCallbacks : ICallbacks
    {
        private readonly string _runId;

        public UnityRailTestCallbacks(string runId)
        {
            _runId = runId;
        }

        public void RunStarted(ITestAdaptor testsToRun)
        {
        }

        public void TestStarted(ITestAdaptor test)
        {
        }

        public void TestFinished(ITestResultAdaptor result)
        {
            if (result.HasChildren) return;
            TestRunRecord record = Current();
            if (record == null) return;
            record.results.Add(Convert(result));
            BridgeState.PersistTestRun();
        }

        public void RunFinished(ITestResultAdaptor result)
        {
            TestRunRecord record = Current();
            if (record == null) return;
            record.results = new List<TestResultRecord>();
            Flatten(result, record.results);
            record.passed = result.PassCount;
            record.failed = result.FailCount;
            record.skipped = result.SkipCount;
            record.finishedAt = BridgeState.Now();
            record.durationMs = (long)Math.Round(result.Duration * 1000.0);
            if (result.FailCount > 0)
            {
                record.state = "failed";
            }
            else if (result.PassCount + result.SkipCount + result.InconclusiveCount == 0)
            {
                record.state = "error";
                record.error = "The test run finished without any tests. Check the filter and test assembly.";
            }
            else
            {
                record.state = "passed";
            }
            BridgeState.PersistTestRun();
        }

        private TestRunRecord Current()
        {
            if (BridgeState.TestRun == null || BridgeState.TestRun.runId != _runId) return null;
            return BridgeState.TestRun;
        }

        private static void Flatten(ITestResultAdaptor result, List<TestResultRecord> into)
        {
            if (result.HasChildren)
            {
                foreach (ITestResultAdaptor child in result.Children)
                {
                    Flatten(child, into);
                }
                return;
            }
            into.Add(Convert(result));
        }

        private static TestResultRecord Convert(ITestResultAdaptor result)
        {
            return new TestResultRecord
            {
                name = result.Name,
                fullName = result.FullName,
                status = StatusOf(result.TestStatus),
                durationMs = (long)Math.Round(result.Duration * 1000.0),
                message = Truncate(result.Message),
                stackTrace = Truncate(result.StackTrace),
            };
        }

        private static string StatusOf(TestStatus status)
        {
            switch (status)
            {
                case TestStatus.Passed: return "passed";
                case TestStatus.Failed: return "failed";
                case TestStatus.Skipped: return "skipped";
                default: return "inconclusive";
            }
        }

        private static string Truncate(string value)
        {
            if (string.IsNullOrEmpty(value)) return null;
            return value.Length <= 4000 ? value : value.Substring(0, 4000) + "\n[truncated]";
        }
    }
}
