using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using UnityEditor;

namespace UnityRail.Bridge
{
    /**
     * Marks a static project method as an Editor tool the agent can call through `unity_editor_tool`.
     *
     * <code>
     * [BridgeTool("create_folder", "Create a folder under the project.", "path: project-relative folder")]
     * public static object CreateFolder(JObject parameters) { ... }
     * </code>
     *
     * The method must be `public static`, take one `JObject` and return a JSON-serializable value.
     * The assembly it lives in must reference `ThinkRail.Bridge.Editor` (auto-referenced editor
     * assemblies such as Assembly-CSharp-Editor need no reference).
     */
    [AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
    public sealed class BridgeToolAttribute : Attribute
    {
        public string Name { get; private set; }
        public string Description { get; private set; }
        /** Free-form parameter documentation for the agent, e.g. "path: project-relative folder". */
        public string Parameters { get; private set; }

        public BridgeToolAttribute(string name, string description = null, string parameters = null)
        {
            Name = name;
            Description = description;
            Parameters = parameters;
        }
    }

    /** Discovers project-registered [BridgeTool] methods and invokes them on the Editor main thread. */
    public static class BridgeCustomTools
    {
        private sealed class Entry
        {
            public string Name;
            public string Description;
            public string Parameters;
            public MethodInfo Method;
        }

        /** Every callable tool, ordered by name so the agent's list is stable across reloads. */
        public static List<object> Descriptors()
        {
            return Entries()
                .Select(entry => (object)new
                {
                    name = entry.Name,
                    description = entry.Description ?? "",
                    parameters = entry.Parameters,
                })
                .ToList();
        }

        public static object Invoke(string name, JObject parameters)
        {
            Entry entry = Entries().FirstOrDefault(candidate => candidate.Name == name);
            if (entry == null)
            {
                throw new BridgeHttpException(404, "No [BridgeTool] named \"" + name + "\" is registered in this project.");
            }
            object result;
            try
            {
                result = entry.Method.Invoke(null, new object[] { parameters ?? new JObject() });
            }
            catch (TargetInvocationException error)
            {
                Exception inner = error.InnerException ?? error;
                throw new BridgeHttpException(500, "BridgeTool " + name + " threw " + inner.GetType().Name + ": " + inner.Message);
            }
            catch (Exception error)
            {
                throw new BridgeHttpException(500, "BridgeTool " + name + " could not run: " + error.Message);
            }
            try
            {
                return JToken.FromObject(result ?? JValue.CreateNull());
            }
            catch (Exception error)
            {
                throw new BridgeHttpException(500, "BridgeTool " + name + " returned a value that is not JSON-serializable: " + error.Message);
            }
        }

        private static List<Entry> Entries()
        {
            List<Entry> entries = new List<Entry>();
            HashSet<string> names = new HashSet<string>(StringComparer.Ordinal);
            foreach (MethodInfo method in TypeCache.GetMethodsWithAttribute<BridgeToolAttribute>())
            {
                BridgeToolAttribute attribute = method.GetCustomAttribute<BridgeToolAttribute>();
                if (attribute == null || string.IsNullOrEmpty(attribute.Name)) continue;
                if (!method.IsStatic || method.IsAbstract || method.IsGenericMethodDefinition) continue;
                ParameterInfo[] parameters = method.GetParameters();
                if (parameters.Length != 1) continue;
                if (!parameters[0].ParameterType.IsAssignableFrom(typeof(JObject))) continue;
                if (method.ReturnType == typeof(void)) continue;
                if (!names.Add(attribute.Name)) continue;
                entries.Add(new Entry
                {
                    Name = attribute.Name,
                    Description = attribute.Description,
                    Parameters = attribute.Parameters,
                    Method = method,
                });
            }
            entries.Sort((left, right) => string.CompareOrdinal(left.Name, right.Name));
            return entries;
        }
    }

    public static partial class BridgeRoutes
    {
        private static BridgeResponse ListTools()
        {
            return MainThread.Run(delegate
            {
                return BridgeResponse.Json(new { ok = true, tools = BridgeCustomTools.Descriptors() });
            }, 30000);
        }

        private static BridgeResponse InvokeTool(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string name = ((string)body["name"] ?? "").Trim();
            if (name.Length == 0) return BridgeResponse.Error(400, "MISSING_NAME", "Invoking a tool requires a name.");
            JObject parameters = body["parameters"] as JObject;
            return MainThread.Run(delegate
            {
                if (EditorApplication.isCompiling || EditorApplication.isUpdating)
                {
                    throw new BridgeHttpException(409, "Unity is compiling or importing; wait for it to finish.");
                }
                object result = BridgeCustomTools.Invoke(name, parameters);
                return BridgeResponse.Json(new { ok = true, name, result });
            }, 120000);
        }
    }
}
