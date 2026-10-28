
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

const params = new URLSearchParams(window.location.search);
const initialRole =
  params.get("role") === "viewer" ? "viewer" : "sender";

export default function App() {
  const [role] = useState(initialRole);
  const [roomId, setRoomId] = useState("couple-room");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState("Belum terhubung");

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const videoRef = useRef(null);
  const wakeLockRef = useRef(null);
  const remoteCandidatesRef = useRef([]);

  const createPeer = (socket, stream = null) => {
    if (pcRef.current) {
      pcRef.current.close();
    }

    remoteCandidatesRef.current = [];

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("signal", {
          type: "candidate",
          data: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      if (videoRef.current && role === "viewer") {
        videoRef.current.srcObject = event.streams[0];
        setStatus("Video diterima");
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setStatus("Streaming terhubung");
      }

      if (
        ["failed", "disconnected"].includes(pc.connectionState)
      ) {
        setStatus("Koneksi video terputus");
      }
    };

    if (stream) {
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    }

    pcRef.current = pc;
    return pc;
  };

  const createOffer = async () => {
    const socket = socketRef.current;
    const stream = localStreamRef.current;

    if (!socket || !stream) return;

    const pc = createPeer(socket, stream);
    const offer = await pc.createOffer();

    await pc.setLocalDescription(offer);

    socket.emit("signal", {
      type: "offer",
      data: pc.localDescription,
    });
  };

  const handleSignal = async ({ type, data }) => {
    const socket = socketRef.current;
    if (!socket) return;

    try {
      if (type === "offer" && role === "viewer") {
        const pc = createPeer(socket);

        await pc.setRemoteDescription(data);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("signal", {
          type: "answer",
          data: pc.localDescription,
        });

        for (const candidate of remoteCandidatesRef.current) {
          await pc.addIceCandidate(candidate);
        }
        remoteCandidatesRef.current = [];
      }

      if (type === "answer" && pcRef.current) {
        await pcRef.current.setRemoteDescription(data);

        for (const candidate of remoteCandidatesRef.current) {
          await pcRef.current.addIceCandidate(candidate);
        }
        remoteCandidatesRef.current = [];
      }

      if (type === "candidate") {
        if (pcRef.current?.remoteDescription) {
          await pcRef.current.addIceCandidate(data);
        } else {
          remoteCandidatesRef.current.push(data);
        }
      }
    } catch (error) {
      console.error(error);
      setStatus("Gagal memproses koneksi video");
    }
  };

  const connect = () => {
    if (!token.trim() || !roomId.trim()) {
      setStatus("Isi kode akses dan Room ID");
      return;
    }

    const socket = io(SERVER_URL, {
      autoConnect: false,
      auth: { token },
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join", { roomId, role });
    });

    socket.on("joined", () => {
      setConnected(true);
      setStatus("Terhubung ke server");
    });

    socket.on("peer-ready", () => {
      if (role === "sender" && localStreamRef.current) {
        createOffer();
      }
    });

    socket.on("signal", handleSignal);

    socket.on("stream-stopped", () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      pcRef.current?.close();
      pcRef.current = null;
      setStatus("Pemilik HP menghentikan kamera");
    });

    socket.on("peer-left", () => {
      setStatus("Perangkat lain terputus");
      pcRef.current?.close();
      pcRef.current = null;
    });

    socket.on("app-error", setStatus);

    socket.on("connect_error", (error) => {
      setStatus(error.message);
    });

    socket.connect();
  };

  const startCamera = async () => {
    if (!connected || role !== "sender") return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      localStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setStreaming(true);
      setStatus("Kamera aktif dan sedang dibagikan");

      if ("wakeLock" in navigator) {
        try {
          wakeLockRef.current =
            await navigator.wakeLock.request("screen");
        } catch (error) {
          console.warn("Wake Lock tidak tersedia", error);
        }
      }

      await createOffer();
    } catch (error) {
      console.error(error);
      setStatus("Izin kamera ditolak atau kamera tidak tersedia");
    }
  };

  const stopCamera = () => {
    localStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    localStreamRef.current = null;

    pcRef.current?.close();
    pcRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;

    socketRef.current?.emit("stream-stopped");

    setStreaming(false);
    setStatus("Kamera dimatikan");
  };

  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      socketRef.current?.disconnect();
      wakeLockRef.current?.release().catch(() => {});
    };
  }, []);

  return (
    <main className="container">
      <div className="app">
        <header>
          <span className="logo">♥ Couple Cam</span>
          <span className="role">
            {role === "sender" ? "Kamera Android" : "Dashboard"}
          </span>
        </header>

        <h1>
          {role === "sender"
            ? "Bagikan Kamera"
            : "Live Camera Viewer"}
        </h1>

        <p className="subtitle">
          {role === "sender"
            ? "Kamera hanya aktif setelah kamu menekan Mulai Kamera."
            : "Lihat video setelah pemilik HP menyetujui streaming."}
        </p>

        {!connected && (
          <section className="form">
            <label>Room ID</label>
            <input
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="couple-room"
            />

            <label>Kode Akses</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Masukkan kode rahasia"
            />

            <button onClick={connect}>
              Hubungkan Perangkat
            </button>
          </section>
        )}

        <section className="camera">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
          />

          {role === "sender" && streaming && (
            <div className="live-indicator">
              ● KAMERA AKTIF
            </div>
          )}

          {role === "viewer" && (
            <div className="viewer-label">
              LIVE VIEW
            </div>
          )}
        </section>

        <div className="status">{status}</div>

        {role === "sender" && connected && (
          <div className="controls">
            {!streaming ? (
              <button onClick={startCamera}>
                Mulai Kamera
              </button>
            ) : (
              <button className="stop" onClick={stopCamera}>
                Hentikan Kamera
              </button>
            )}
          </div>
        )}

        <footer>
          Streaming hanya dengan persetujuan pemilik perangkat.
        </footer>
      </div>
    </main>
  );
}
