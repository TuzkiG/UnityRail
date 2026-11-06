using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace UnityRail.Bridge
{
    /// <summary>
    /// Write endpoints. Every structural change goes through Undo and is saved only when the caller asks
    /// for it, so a failed or regretted edit is one `POST /v1/undo` away. Reads never leave dirty state.
    /// </summary>
    public static partial class BridgeRoutes
    {
        private static readonly Dictionary<string, Type> ComponentTypes = new Dictionary<string, Type>();

        private static BridgeResponse CreateObject(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string name = ((string)body["name"] ?? "").Trim();
            if (name.Length == 0) return BridgeResponse.Error(400, "MISSING_NAME", "create requires a name.");
            string parentPath = (string)body["parent"];
            string[] components = StringArray(body["components"]);
            bool save = body["save"] != null && (bool)body["save"];
            return MainThread.Run(delegate
            {
                GameObject parent = null;
                if (!string.IsNullOrEmpty(parentPath))
                {
                    parent = FindEditObject(parentPath);
                    if (parent == null) throw new BridgeHttpException(404, "No GameObject at " + parentPath + ".");
                }
                GameObject created = new GameObject(name);
                Undo.RegisterCreatedObjectUndo(created, "UnityRail Create " + name);
                if (parent != null)
                {
                    Undo.SetTransformParent(created.transform, parent.transform, "UnityRail Parent " + name);
                    created.transform.localPosition = Vector3.zero;
                }
                List<string> added = new List<string>();
                foreach (string component in components)
                {
                    if (string.IsNullOrEmpty(component) || component == "Transform") continue;
                    Type type = ResolveComponentType(component);
                    if (type == null) throw new BridgeHttpException(400, "Unknown component type: " + component + ".");
                    Undo.AddComponent(created, type);
                    added.Add(type.Name);
                }
                MarkDirty();
                if (save) SaveEditScene();
                return BridgeResponse.Json(new
                {
                    ok = true,
                    path = HierarchyUtil.PathOf(created),
                    instanceId = created.GetInstanceID(),
                    components = added,
                    saved = save,
                });
            }, 30000);
        }

        private static BridgeResponse DeleteObject(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string path = (string)body["path"];
            if (string.IsNullOrEmpty(path)) return BridgeResponse.Error(400, "MISSING_PATH", "delete requires a path.");
            bool save = body["save"] != null && (bool)body["save"];
            return MainThread.Run(delegate
            {
                GameObject target = FindEditObject(path);
                if (target == null) throw new BridgeHttpException(404, "No GameObject at " + path + ".");
                if (PrefabStageUtility.GetCurrentPrefabStage() != null &&
                    PrefabStageUtility.GetCurrentPrefabStage().prefabContentsRoot == target)
                {
                    throw new BridgeHttpException(409, "The prefab root cannot be deleted from the prefab stage.");
                }
                Undo.DestroyObjectImmediate(target);
                MarkDirty();
                if (save) SaveEditScene();
                return BridgeResponse.Json(new { ok = true, path, saved = save });
            }, 30000);
        }

        private static BridgeResponse AddComponent(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string path = (string)body["path"];
            string component = (string)body["component"];
            if (string.IsNullOrEmpty(path)) return BridgeResponse.Error(400, "MISSING_PATH", "addComponent requires a path.");
            if (string.IsNullOrEmpty(component)) return BridgeResponse.Error(400, "MISSING_COMPONENT", "addComponent requires a component type.");
            bool save = body["save"] != null && (bool)body["save"];
            return MainThread.Run(delegate
            {
                GameObject target = FindEditObject(path);
                if (target == null) throw new BridgeHttpException(404, "No GameObject at " + path + ".");
                Type type = ResolveComponentType(component);
                if (type == null) throw new BridgeHttpException(400, "Unknown component type: " + component + ".");
                Component added = Undo.AddComponent(target, type);
                MarkDirty();
                if (save) SaveEditScene();
                return BridgeResponse.Json(new
                {
                    ok = true,
                    path,
                    component = type.Name,
                    instanceId = added != null ? added.GetInstanceID() : 0,
                    saved = save,
                });
            }, 30000);
        }

        private static BridgeResponse RemoveComponent(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string path = (string)body["path"];
            string component = (string)body["component"];
            int index = body["index"] != null ? (int)body["index"] : 0;
            if (string.IsNullOrEmpty(path)) return BridgeResponse.Error(400, "MISSING_PATH", "removeComponent requires a path.");
            if (string.IsNullOrEmpty(component)) return BridgeResponse.Error(400, "MISSING_COMPONENT", "removeComponent requires a component type.");
            bool save = body["save"] != null && (bool)body["save"];
            return MainThread.Run(delegate
            {
                GameObject target = FindEditObject(path);
                if (target == null) throw new BridgeHttpException(404, "No GameObject at " + path + ".");
                Component match = target.GetComponents<Component>()
                    .Where((entry) => entry != null)
                    .Where((entry) => entry.GetType().Name == component || entry.GetType().FullName == component)
                    .Skip(Math.Max(0, index))
                    .FirstOrDefault();
                if (match == null) throw new BridgeHttpException(404, "No " + component + " on " + path + ".");
                string removed = match.GetType().Name;
                Undo.DestroyObjectImmediate(match);
                MarkDirty();
                if (save) SaveEditScene();
                return BridgeResponse.Json(new { ok = true, path, component = removed, saved = save });
            }, 30000);
        }

        private static BridgeResponse SetProperty(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string path = (string)body["path"];
            string component = (string)body["component"];
            string propertyPath = (string)body["property"];
            if (string.IsNullOrEmpty(path)) return BridgeResponse.Error(400, "MISSING_PATH", "setProperty requires a path.");
            if (string.IsNullOrEmpty(component)) return BridgeResponse.Error(400, "MISSING_COMPONENT", "setProperty requires a component type.");
            if (string.IsNullOrEmpty(propertyPath)) return BridgeResponse.Error(400, "MISSING_PROPERTY", "setProperty requires a property path.");
            if (body["value"] == null) return BridgeResponse.Error(400, "MISSING_VALUE", "setProperty requires a value.");
            JToken value = body["value"];
            int index = body["index"] != null ? (int)body["index"] : 0;
            bool save = body["save"] != null && (bool)body["save"];
            return MainThread.Run(delegate
            {
                GameObject target = FindEditObject(path);
                if (target == null) throw new BridgeHttpException(404, "No GameObject at " + path + ".");
                Component owner = target.GetComponents<Component>()
                    .Where((entry) => entry != null)
                    .Where((entry) => entry.GetType().Name == component || entry.GetType().FullName == component)
                    .Skip(Math.Max(0, index))
                    .FirstOrDefault();
                if (owner == null) throw new BridgeHttpException(404, "No " + component + " on " + path + ".");
                SerializedObject serialized = new SerializedObject(owner);
                serialized.Update();
                SerializedProperty property = serialized.FindProperty(propertyPath);
                if (property == null) throw new BridgeHttpException(404, "No property " + propertyPath + " on " + component + ".");
                string before = DescribeProperty(property);
                if (!ApplyProperty(property, value))
                {
                    throw new BridgeHttpException(400, "Unsupported property type " + property.propertyType + " for " + propertyPath + ".");
                }
                Undo.RecordObject(owner, "UnityRail Set " + propertyPath);
                serialized.ApplyModifiedProperties();
                EditorUtility.SetDirty(owner);
                serialized.Update();
                string after = DescribeProperty(serialized.FindProperty(propertyPath));
                MarkDirty();
                if (save) SaveEditScene();
                return BridgeResponse.Json(new
                {
                    ok = true,
                    path,
                    component = owner.GetType().Name,
                    property = propertyPath,
                    before,
                    after,
                    saved = save,
                });
            }, 30000);
        }

        private static BridgeResponse SaveScene(BridgeRequest request)
        {
            JObject body = ParseBody(request);
            string path = (string)body["path"];
            return MainThread.Run(delegate
            {
                if (!string.IsNullOrEmpty(path) && !path.StartsWith("Assets/"))
                {
                    throw new BridgeHttpException(400, "Only project-relative Assets/ paths can be saved.");
                }
                string savedPath = SaveEditScene();
                return BridgeResponse.Json(new { ok = true, path = savedPath });
            }, 60000);
        }

        private static BridgeResponse PerformUndo(BridgeRequest request)
        {
            JObject body = string.IsNullOrEmpty(request.Body) ? new JObject() : ParseBody(request);
            int steps = body["steps"] != null ? Math.Max(1, Math.Min(10, (int)body["steps"])) : 1;
            return MainThread.Run(delegate
            {
                for (int step = 0; step < steps; step += 1) Undo.PerformUndo();
                MarkDirty();
                return BridgeResponse.Json(new { ok = true, steps });
            }, 30000);
        }

        private static GameObject FindEditObject(string path)
        {
            PrefabStage stage = PrefabStageUtility.GetCurrentPrefabStage();
            if (stage != null && stage.prefabContentsRoot != null)
            {
                GameObject root = stage.prefabContentsRoot;
                if (string.IsNullOrEmpty(path) || path == root.name) return root;
                string relative = path.StartsWith(root.name + "/") ? path.Substring(root.name.Length + 1) : path;
                Transform found = root.transform.Find(relative);
                return found != null ? found.gameObject : null;
            }
            return HierarchyUtil.FindByPath(path);
        }

        private static Type ResolveComponentType(string name)
        {
            string key = name.Trim();
            Type cached;
            if (ComponentTypes.TryGetValue(key, out cached)) return cached;
            foreach (Assembly assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type[] types;
                try
                {
                    types = assembly.GetTypes();
                }
                catch (ReflectionTypeLoadException partial)
                {
                    types = partial.Types.Where((type) => type != null).ToArray();
                }
                catch
                {
                    continue;
                }
                foreach (Type type in types)
                {
                    if (!typeof(Component).IsAssignableFrom(type) || type.IsAbstract) continue;
                    if (type.FullName != key && type.Name != key) continue;
                    ComponentTypes[key] = type;
                    return type;
                }
            }
            ComponentTypes[key] = null;
            return null;
        }

        private static void MarkDirty()
        {
            Scene scene = SceneManager.GetActiveScene();
            if (scene.IsValid()) EditorSceneManager.MarkSceneDirty(scene);
        }

        private static string SaveEditScene()
        {
            PrefabStage stage = PrefabStageUtility.GetCurrentPrefabStage();
            if (stage != null && stage.prefabContentsRoot != null)
            {
                PrefabUtility.SaveAsPrefabAsset(stage.prefabContentsRoot, stage.assetPath);
                EditorSceneManager.SaveScene(stage.scene);
                return stage.assetPath;
            }
            Scene scene = SceneManager.GetActiveScene();
            if (!scene.IsValid()) throw new BridgeHttpException(409, "No scene is open in the Editor.");
            if (!EditorSceneManager.SaveScene(scene)) throw new BridgeHttpException(409, "Unity refused to save " + scene.path + ".");
            return scene.path;
        }

        private static string[] StringArray(JToken token)
        {
            JArray array = token as JArray;
            if (array == null) return new string[0];
            return array.Select((entry) => (string)entry).Where((entry) => !string.IsNullOrEmpty(entry)).ToArray();
        }

        private static string DescribeProperty(SerializedProperty property)
        {
            if (property == null) return "";
            switch (property.propertyType)
            {
                case SerializedPropertyType.Integer:
                    return property.intValue.ToString();
                case SerializedPropertyType.Boolean:
                    return property.boolValue ? "true" : "false";
                case SerializedPropertyType.Float:
                    return property.floatValue.ToString("0.####");
                case SerializedPropertyType.String:
                    return property.stringValue;
                case SerializedPropertyType.Enum:
                    return property.enumNames.Length > property.enumValueIndex && property.enumValueIndex >= 0
                        ? property.enumNames[property.enumValueIndex]
                        : property.enumValueIndex.ToString();
                case SerializedPropertyType.Color:
                    return string.Format("{0},{1},{2},{3}", property.colorValue.r, property.colorValue.g, property.colorValue.b, property.colorValue.a);
                case SerializedPropertyType.Vector2:
                    return property.vector2Value.ToString();
                case SerializedPropertyType.Vector3:
                    return property.vector3Value.ToString();
                case SerializedPropertyType.Vector4:
                    return property.vector4Value.ToString();
                case SerializedPropertyType.ObjectReference:
                    return DescribeObject(property.objectReferenceValue);
                case SerializedPropertyType.ArraySize:
                    return property.intValue.ToString();
                case SerializedPropertyType.LayerMask:
                    return property.intValue.ToString();
                default:
                    return property.propertyType.ToString();
            }
        }

        private static string DescribeObject(Object value)
        {
            if (value == null) return "";
            GameObject gameObject = value as GameObject;
            if (gameObject != null) return HierarchyUtil.PathOf(gameObject);
            Component component = value as Component;
            if (component != null) return HierarchyUtil.PathOf(component.gameObject) + " (" + component.GetType().Name + ")";
            string assetPath = AssetDatabase.GetAssetPath(value);
            return string.IsNullOrEmpty(assetPath) ? value.name : assetPath;
        }

        private static bool ApplyProperty(SerializedProperty property, JToken value)
        {
            switch (property.propertyType)
            {
                case SerializedPropertyType.Integer:
                case SerializedPropertyType.LayerMask:
                case SerializedPropertyType.ArraySize:
                    property.intValue = value.Type == JTokenType.String ? int.Parse((string)value) : (int)value;
                    return true;
                case SerializedPropertyType.Boolean:
                    property.boolValue = value.Type == JTokenType.String ? bool.Parse((string)value) : (bool)value;
                    return true;
                case SerializedPropertyType.Float:
                    property.floatValue = value.Type == JTokenType.String ? float.Parse((string)value) : (float)value;
                    return true;
                case SerializedPropertyType.String:
                    property.stringValue = value.Type == JTokenType.Null ? "" : value.ToString();
                    return true;
                case SerializedPropertyType.Enum:
                    return ApplyEnum(property, value);
                case SerializedPropertyType.Color:
                    property.colorValue = new Color((float)value["r"], (float)value["g"], (float)value["b"], value["a"] != null ? (float)value["a"] : 1f);
                    return true;
                case SerializedPropertyType.Vector2:
                    property.vector2Value = new Vector2((float)value["x"], (float)value["y"]);
                    return true;
                case SerializedPropertyType.Vector3:
                    property.vector3Value = new Vector3((float)value["x"], (float)value["y"], (float)value["z"]);
                    return true;
                case SerializedPropertyType.Vector4:
                    property.vector4Value = new Vector4((float)value["x"], (float)value["y"], (float)value["z"], value["w"] != null ? (float)value["w"] : 0f);
                    return true;
                case SerializedPropertyType.ObjectReference:
                    property.objectReferenceValue = ResolveObjectReference(value);
                    return true;
                default:
                    return false;
            }
        }

        private static bool ApplyEnum(SerializedProperty property, JToken value)
        {
            if (value.Type == JTokenType.String)
            {
                string name = (string)value;
                for (int index = 0; index < property.enumNames.Length; index += 1)
                {
                    if (string.Equals(property.enumNames[index], name, StringComparison.OrdinalIgnoreCase))
                    {
                        property.enumValueIndex = index;
                        return true;
                    }
                }
                int parsed;
                if (!int.TryParse(name, out parsed)) return false;
                property.enumValueIndex = parsed;
                return true;
            }
            property.enumValueIndex = (int)value;
            return true;
        }

        private static Object ResolveObjectReference(JToken value)
        {
            if (value == null || value.Type == JTokenType.Null) return null;
            string reference = (string)value;
            if (string.IsNullOrEmpty(reference)) return null;
            if (reference.StartsWith("Assets/") || reference.StartsWith("Packages/"))
            {
                Object asset = AssetDatabase.LoadAssetAtPath<Object>(reference);
                if (asset == null) throw new BridgeHttpException(404, "No asset at " + reference + ".");
                return asset;
            }
            GameObject gameObject = FindEditObject(reference);
            if (gameObject == null) throw new BridgeHttpException(404, "No GameObject at " + reference + ".");
            return gameObject;
        }
    }
}
