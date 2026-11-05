using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace UnityRail.Bridge
{
    public static class HierarchyUtil
    {
        private const int MaxNodes = 4000;
        private const int MaxDepth = 16;
        private const int MaxComponents = 64;
        private const int MaxProperties = 80;

        public static string PathOf(GameObject gameObject)
        {
            List<string> names = new List<string>();
            Transform current = gameObject.transform;
            while (current != null)
            {
                names.Add(current.name);
                current = current.parent;
            }
            names.Reverse();
            return string.Join("/", names);
        }

        public static GameObject FindByPath(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;
            string[] parts = path.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return null;
            Scene scene = SceneManager.GetActiveScene();
            GameObject root = null;
            if (scene.IsValid())
            {
                foreach (GameObject candidate in scene.GetRootGameObjects())
                {
                    if (candidate.name == parts[0])
                    {
                        root = candidate;
                        break;
                    }
                }
            }
            if (root == null)
            {
                GameObject found = GameObject.Find(parts[0]);
                if (found != null) root = found.transform.root.gameObject;
            }
            if (root == null) return null;
            if (parts.Length == 1) return root;
            Transform child = root.transform.Find(string.Join("/", parts.Skip(1).ToArray()));
            return child != null ? child.gameObject : null;
        }

        public static object Snapshot(string selector)
        {
            Scene scene = ResolveScene(selector);
            if (!scene.IsValid()) throw new Exception("No valid scene is open in the Editor.");
            int count = 0;
            bool truncated = false;
            List<object> roots = new List<object>();
            foreach (GameObject root in scene.GetRootGameObjects())
            {
                roots.Add(BuildNode(root.transform, count + 1, 0, out count, ref truncated));
                if (truncated) break;
            }
            return new
            {
                scene = scene.name,
                scenePath = scene.path,
                roots,
                truncated,
            };
        }

        private static Scene ResolveScene(string selector)
        {
            if (string.IsNullOrEmpty(selector) || selector == "active")
            {
                return SceneManager.GetActiveScene();
            }
            if (selector == "prefab")
            {
                PrefabStage stage = PrefabStageUtility.GetCurrentPrefabStage();
                return stage != null ? stage.scene : SceneManager.GetActiveScene();
            }
            Scene byPath = SceneManager.GetSceneByPath(selector);
            if (byPath.IsValid()) return byPath;
            return SceneManager.GetSceneByName(selector);
        }

        private static object BuildNode(
            Transform transform,
            int index,
            int depth,
            out int count,
            ref bool truncated)
        {
            count = index;
            GameObject gameObject = transform.gameObject;
            List<object> components = new List<object>();
            Component[] all = gameObject.GetComponents<Component>();
            for (int componentIndex = 0; componentIndex < all.Length && componentIndex < MaxComponents; componentIndex++)
            {
                Component component = all[componentIndex];
                if (component == null) continue;
                Behaviour behaviour = component as Behaviour;
                components.Add(new
                {
                    type = component.GetType().Name,
                    enabled = behaviour == null || behaviour.enabled,
                    instanceId = component.GetInstanceID(),
                });
            }
            List<object> children = new List<object>();
            if (depth < MaxDepth)
            {
                for (int childIndex = 0; childIndex < transform.childCount; childIndex++)
                {
                    if (count >= MaxNodes)
                    {
                        truncated = true;
                        break;
                    }
                    children.Add(BuildNode(transform.GetChild(childIndex), count + 1, depth + 1, out count, ref truncated));
                }
            }
            else if (transform.childCount > 0)
            {
                truncated = true;
            }
            return new
            {
                name = gameObject.name,
                path = PathOf(gameObject),
                scene = gameObject.scene.name,
                activeSelf = gameObject.activeSelf,
                activeInHierarchy = gameObject.activeInHierarchy,
                instanceId = gameObject.GetInstanceID(),
                components,
                children,
            };
        }

        public static object Inspect(string path)
        {
            GameObject gameObject = FindByPath(path);
            if (gameObject == null)
            {
                throw new Exception("No GameObject at path '" + path + "' in the active scene.");
            }
            List<object> components = new List<object>();
            foreach (Component component in gameObject.GetComponents<Component>())
            {
                if (component == null) continue;
                Behaviour behaviour = component as Behaviour;
                components.Add(new
                {
                    type = component.GetType().Name,
                    enabled = behaviour == null || behaviour.enabled,
                    instanceId = component.GetInstanceID(),
                    properties = ReadProperties(component),
                });
            }
            return new
            {
                name = gameObject.name,
                path = PathOf(gameObject),
                scene = gameObject.scene.name,
                tag = gameObject.tag,
                layer = gameObject.layer,
                isStatic = gameObject.isStatic,
                activeSelf = gameObject.activeSelf,
                instanceId = gameObject.GetInstanceID(),
                components,
            };
        }

        private static List<object> ReadProperties(Component component)
        {
            List<object> properties = new List<object>();
            SerializedObject serialized;
            try
            {
                serialized = new SerializedObject(component);
            }
            catch
            {
                return properties;
            }
            serialized.Update();
            SerializedProperty property = serialized.GetIterator();
            bool enterChildren = true;
            int count = 0;
            while (property.NextVisible(enterChildren) && count < MaxProperties)
            {
                enterChildren = false;
                if (property.name == "m_Script") continue;
                properties.Add(new
                {
                    name = property.displayName,
                    type = property.type,
                    value = FormatValue(property),
                });
                count++;
            }
            return properties;
        }

        private static string FormatValue(SerializedProperty property)
        {
            try
            {
                if (property.isArray && property.propertyType != SerializedPropertyType.String)
                {
                    return "Array (" + property.arraySize + ")";
                }
                switch (property.propertyType)
                {
                    case SerializedPropertyType.Integer:
                        return property.intValue.ToString();
                    case SerializedPropertyType.Boolean:
                        return property.boolValue ? "true" : "false";
                    case SerializedPropertyType.Float:
                        return property.floatValue.ToString("0.###");
                    case SerializedPropertyType.String:
                        return Truncate(property.stringValue);
                    case SerializedPropertyType.Color:
                        return property.colorValue.ToString();
                    case SerializedPropertyType.ObjectReference:
                        Object reference = property.objectReferenceValue;
                        if (reference == null) return "(none)";
                        string assetPath = AssetDatabase.GetAssetPath(reference);
                        return string.IsNullOrEmpty(assetPath)
                            ? reference.name + " (" + reference.GetType().Name + ")"
                            : reference.name + " (" + assetPath + ")";
                    case SerializedPropertyType.Enum:
                        string[] names = property.enumNames;
                        int index = property.enumValueIndex;
                        if (names != null && index >= 0 && index < names.Length) return names[index];
                        return index.ToString();
                    case SerializedPropertyType.Vector2:
                        return property.vector2Value.ToString();
                    case SerializedPropertyType.Vector3:
                        return property.vector3Value.ToString();
                    case SerializedPropertyType.Vector4:
                        return property.vector4Value.ToString();
                    case SerializedPropertyType.Vector2Int:
                        return property.vector2IntValue.ToString();
                    case SerializedPropertyType.Vector3Int:
                        return property.vector3IntValue.ToString();
                    case SerializedPropertyType.Rect:
                        return property.rectValue.ToString();
                    case SerializedPropertyType.Bounds:
                        return property.boundsValue.ToString();
                    case SerializedPropertyType.Quaternion:
                        return property.quaternionValue.ToString();
                    case SerializedPropertyType.LayerMask:
                        return property.intValue.ToString();
                    default:
                        if (property.hasChildren) return property.type;
                        return property.type;
                }
            }
            catch
            {
                return "(unreadable)";
            }
        }

        private static string Truncate(string value)
        {
            if (string.IsNullOrEmpty(value)) return "";
            return value.Length <= 400 ? value : value.Substring(0, 400) + "…";
        }
    }
}
