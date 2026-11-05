using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace UnityRail.Bridge
{
    public class BridgeRequest
    {
        public string Method;
        public string Path;
        public Dictionary<string, string> Query = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public string Body = "";
    }

    public class BridgeResponse
    {
        public int Status = 200;
        public string ContentType = "application/json; charset=utf-8";
        public byte[] Body = new byte[0];

        public static BridgeResponse Json(object value, int status = 200)
        {
            return new BridgeResponse
            {
                Status = status,
                ContentType = "application/json; charset=utf-8",
                Body = Encoding.UTF8.GetBytes(BridgeState.ToJson(value)),
            };
        }

        public static BridgeResponse Error(int status, string code, string message)
        {
            return Json(new
            {
                error = new { code, message },
            }, status);
        }

        public static BridgeResponse Png(byte[] bytes)
        {
            return new BridgeResponse
            {
                Status = 200,
                ContentType = "image/png",
                Body = bytes,
            };
        }
    }

    public class ThinkRailBridgeServer
    {
        private readonly TcpListener _listener;
        private readonly Thread _thread;
        private volatile bool _running;
        private readonly Func<BridgeRequest, BridgeResponse> _handler;

        public int Port { get; private set; }

        public ThinkRailBridgeServer(int port, Func<BridgeRequest, BridgeResponse> handler)
        {
            _handler = handler;
            _listener = new TcpListener(IPAddress.Loopback, port);
            _listener.Start();
            Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
            _running = true;
            _thread = new Thread(AcceptLoop);
            _thread.IsBackground = true;
            _thread.Name = "UnityRail Unity Bridge";
            _thread.Start();
        }

        public void Stop()
        {
            _running = false;
            try
            {
                _listener.Stop();
            }
            catch
            {
                // Already stopped.
            }
        }

        private void AcceptLoop()
        {
            while (_running)
            {
                TcpClient client;
                try
                {
                    client = _listener.AcceptTcpClient();
                }
                catch
                {
                    if (!_running) return;
                    continue;
                }
                ThreadPool.QueueUserWorkItem(delegate
                {
                    using (client)
                    {
                        HandleClient(client);
                    }
                });
            }
        }

        private void HandleClient(TcpClient client)
        {
            try
            {
                client.ReceiveTimeout = 15000;
                client.SendTimeout = 30000;
                using (NetworkStream stream = client.GetStream())
                {
                    BridgeRequest request = ReadRequest(stream);
                    if (request == null) return;
                    BridgeResponse response = Authorize(request) ?? _handler(request);
                    WriteResponse(stream, response);
                }
            }
            catch (Exception error)
            {
                try
                {
                    using (NetworkStream stream = client.GetStream())
                    {
                        WriteResponse(stream, BridgeResponse.Error(500, "INTERNAL", error.Message));
                    }
                }
                catch
                {
                    // The client is gone; nothing to answer.
                }
            }
        }

        private BridgeResponse Authorize(BridgeRequest request)
        {
            if (request.Path == "/v1/health") return null;
            if (string.IsNullOrEmpty(BridgeRuntime.Token))
            {
                return BridgeResponse.Error(503, "BRIDGE_STARTING", "The bridge is still starting.");
            }
            string expected = "Bearer " + BridgeRuntime.Token;
            string actual;
            if (!request.Headers.TryGetValue("authorization", out actual) || actual != expected)
            {
                return BridgeResponse.Error(401, "UNAUTHORIZED", "Missing or invalid bridge token.");
            }
            return null;
        }

        private static BridgeRequest ReadRequest(NetworkStream stream)
        {
            const int MaxHeader = 64 * 1024;
            MemoryStream buffer = new MemoryStream();
            byte[] chunk = new byte[8192];
            int headerEnd = -1;
            while (buffer.Length < MaxHeader)
            {
                int read = stream.Read(chunk, 0, chunk.Length);
                if (read <= 0) break;
                buffer.Write(chunk, 0, read);
                headerEnd = FindHeaderEnd(buffer.GetBuffer(), (int)buffer.Length);
                if (headerEnd >= 0) break;
            }
            if (headerEnd < 0) return null;
            byte[] data = buffer.GetBuffer();
            string headerText = Encoding.UTF8.GetString(data, 0, headerEnd);
            string[] lines = headerText.Split(new[] { "\r\n" }, StringSplitOptions.None);
            if (lines.Length == 0) return null;
            string[] requestLine = lines[0].Split(' ');
            if (requestLine.Length < 2) return null;

            BridgeRequest request = new BridgeRequest
            {
                Method = requestLine[0].ToUpperInvariant(),
            };
            string target = requestLine[1];
            int queryStart = target.IndexOf('?');
            request.Path = queryStart >= 0 ? target.Substring(0, queryStart) : target;
            if (queryStart >= 0) ParseQuery(target.Substring(queryStart + 1), request.Query);

            for (int index = 1; index < lines.Length; index++)
            {
                int colon = lines[index].IndexOf(':');
                if (colon <= 0) continue;
                string name = lines[index].Substring(0, colon).Trim();
                string value = lines[index].Substring(colon + 1).Trim();
                request.Headers[name] = value;
            }

            int contentLength = 0;
            string lengthHeader;
            if (request.Headers.TryGetValue("content-length", out lengthHeader))
            {
                int.TryParse(lengthHeader, NumberStyles.Integer, CultureInfo.InvariantCulture, out contentLength);
            }
            if (contentLength > 0)
            {
                int bodyStart = headerEnd + 4;
                int already = (int)buffer.Length - bodyStart;
                MemoryStream body = new MemoryStream();
                if (already > 0) body.Write(data, bodyStart, already);
                int remaining = contentLength - Math.Max(0, already);
                while (remaining > 0)
                {
                    int read = stream.Read(chunk, 0, Math.Min(chunk.Length, remaining));
                    if (read <= 0) break;
                    body.Write(chunk, 0, read);
                    remaining -= read;
                }
                request.Body = Encoding.UTF8.GetString(body.ToArray());
            }
            return request;
        }

        private static int FindHeaderEnd(byte[] data, int length)
        {
            for (int index = 0; index + 3 < length; index++)
            {
                if (data[index] == 13 && data[index + 1] == 10 && data[index + 2] == 13 && data[index + 3] == 10)
                {
                    return index;
                }
            }
            return -1;
        }

        private static void ParseQuery(string query, Dictionary<string, string> into)
        {
            foreach (string pair in query.Split('&'))
            {
                if (string.IsNullOrEmpty(pair)) continue;
                int equals = pair.IndexOf('=');
                string key = equals >= 0 ? pair.Substring(0, equals) : pair;
                string value = equals >= 0 ? pair.Substring(equals + 1) : "";
                into[Uri.UnescapeDataString(key)] = Uri.UnescapeDataString(value);
            }
        }

        private static void WriteResponse(NetworkStream stream, BridgeResponse response)
        {
            byte[] body = response.Body ?? new byte[0];
            string head = "HTTP/1.1 " + response.Status + " " + Reason(response.Status) + "\r\n" +
                          "Content-Type: " + response.ContentType + "\r\n" +
                          "Content-Length: " + body.Length + "\r\n" +
                          "Cache-Control: no-store\r\n" +
                          "Connection: close\r\n\r\n";
            byte[] headBytes = Encoding.ASCII.GetBytes(head);
            stream.Write(headBytes, 0, headBytes.Length);
            if (body.Length > 0) stream.Write(body, 0, body.Length);
            stream.Flush();
        }

        private static string Reason(int status)
        {
            switch (status)
            {
                case 200: return "OK";
                case 400: return "Bad Request";
                case 401: return "Unauthorized";
                case 404: return "Not Found";
                case 409: return "Conflict";
                case 500: return "Internal Server Error";
                default: return "OK";
            }
        }
    }

    public static class BridgeRuntime
    {
        public static bool Running;
        public static string Token = "";
        public static string StartedAt = "";
        public static ThinkRailBridgeServer Server;
    }
}
