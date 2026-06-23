'use client';

/**
 * CallRoom — 1on1 音声・ビデオ通話の UI + WebRTC ロジック
 *
 * 役割:
 *   - SSE で /api/call/[roomId]/events に接続
 *   - getUserMedia でカメラ・マイク取得
 *   - RTCPeerConnection を生成、相手とは P2P で接続
 *   - シグナリング (offer/answer/ice) は POST /api/call/[roomId]/signal を中継
 *
 * Offer/Answer の役割分担:
 *   - 演者 (performer) = Offerer  (相手の peer-joined を受けたら offer を作成)
 *   - ファン  (fan)       = Answerer (hello で既に演者が居れば、演者の offer を待つ)
 *
 * ⚠️ 開発用最小構成:
 *   - STUN のみ (TURN なし) → LAN を跨ぐと繋がらない可能性あり
 *   - 同時に 2 人しか想定していない (3 人目が入ると最後に来た方とだけ繋がる)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  PhoneOff,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import type { SignalMessage } from '@/lib/call-types';

type Role = 'performer' | 'fan';

type SignalEvent =
  | { type: 'hello'; clientId: string; role: Role; peers: { clientId: string; role: Role }[] }
  | { type: 'peer-joined'; clientId: string; role: Role }
  | { type: 'peer-left'; clientId: string }
  | { type: 'signal'; from: string; payload: SignalMessage }
  | { type: 'ping' };

type Status =
  | 'idle'
  | 'requesting-media'
  | 'connecting'
  | 'waiting'
  | 'in-call'
  | 'ended'
  | 'error';

// fallback: ICE サーバーが API から取れない場合に使う最小構成 (STUN のみ)
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * /api/call/ice-servers から TURN を含む iceServers 設定を取得する。
 * 失敗時は STUN のみのフォールバックを返す。
 */
async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch('/api/call/ice-servers', { cache: 'no-store' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = (await res.json()) as { iceServers?: RTCIceServer[] };
    if (Array.isArray(json.iceServers) && json.iceServers.length > 0) {
      return json.iceServers;
    }
  } catch (err) {
    console.warn('[call] fetchIceServers failed, falling back to STUN only', err);
  }
  return FALLBACK_ICE_SERVERS;
}

export type CallRoomProps = {
  roomId: string;
  role: Role;
  /** 相手の表示名 (UI 用) */
  peerLabel?: string;
};

export function CallRoom({ roomId, role, peerLabel }: CallRoomProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [peerCount, setPeerCount] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const iceServersRef = useRef<RTCIceServer[] | null>(null);
  const myIdRef = useRef<string | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const isOffererRef = useRef<boolean>(false);
  // SSE は state 更新前にも届くため、status を ref でも保持
  const statusRef = useRef<Status>('idle');
  const updateStatus = useCallback((s: Status) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  // ---------------------------------------------------------------
  // POST /api/call/[roomId]/signal にメッセージを送る
  // ---------------------------------------------------------------
  const postSignal = useCallback(
    async (payload: SignalMessage, to?: string) => {
      const from = myIdRef.current;
      if (!from) return;
      try {
        await fetch(`/api/call/${encodeURIComponent(roomId)}/signal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to, payload }),
        });
      } catch (err) {
        console.error('[call] postSignal failed', err);
      }
    },
    [roomId],
  );

  // ---------------------------------------------------------------
  // RTCPeerConnection を初期化
  // ---------------------------------------------------------------
  const createPeerConnection = useCallback((): RTCPeerConnection => {
    const iceServers = iceServersRef.current ?? FALLBACK_ICE_SERVERS;
    const pc = new RTCPeerConnection({ iceServers });

    // 自分のトラックを送信
    const stream = localStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }
    }

    // ICE candidate を相手に送る
    pc.onicecandidate = (ev) => {
      postSignal(
        { kind: 'ice', candidate: ev.candidate ? ev.candidate.toJSON() : null },
        peerIdRef.current ?? undefined,
      );
    };

    // 相手のトラックを受信
    pc.ontrack = (ev) => {
      const [remoteStream] = ev.streams;
      if (remoteStream && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        updateStatus('in-call');
      } else if (s === 'failed' || s === 'disconnected') {
        updateStatus('ended');
      }
    };

    return pc;
  }, [postSignal, updateStatus]);

  // ---------------------------------------------------------------
  // 演者側 (Offerer) が相手に offer を投げる
  // ---------------------------------------------------------------
  const makeOffer = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    isOffererRef.current = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await postSignal({ kind: 'offer', sdp: offer.sdp ?? '' }, peerIdRef.current ?? undefined);
  }, [postSignal]);

  // ---------------------------------------------------------------
  // SSE で受信したシグナルを処理
  // ---------------------------------------------------------------
  const handleSignal = useCallback(
    async (from: string, payload: SignalMessage) => {
      const pc = pcRef.current;
      if (!pc) return;

      if (payload.kind === 'offer') {
        peerIdRef.current = from;
        await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await postSignal({ kind: 'answer', sdp: answer.sdp ?? '' }, from);
      } else if (payload.kind === 'answer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
      } else if (payload.kind === 'ice') {
        try {
          if (payload.candidate) {
            await pc.addIceCandidate(payload.candidate);
          }
        } catch (err) {
          console.warn('[call] addIceCandidate failed', err);
        }
      }
    },
    [postSignal],
  );

  // ---------------------------------------------------------------
  // 入室処理
  // ---------------------------------------------------------------
  const start = useCallback(async () => {
    setErrorMsg(null);
    updateStatus('requesting-media');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('[call] getUserMedia failed', err);
      setErrorMsg('カメラ・マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。');
      updateStatus('error');
      return;
    }

    updateStatus('connecting');

    // ICE servers (STUN + 必要なら TURN) を取得してから PC を作る
    iceServersRef.current = await fetchIceServers();
    pcRef.current = createPeerConnection();

    // SSE 接続
    const es = new EventSource(
      `/api/call/${encodeURIComponent(roomId)}/events?role=${encodeURIComponent(role)}`,
    );
    eventSourceRef.current = es;

    es.onmessage = async (ev) => {
      let data: SignalEvent;
      try {
        data = JSON.parse(ev.data) as SignalEvent;
      } catch {
        return;
      }

      if (data.type === 'hello') {
        myIdRef.current = data.clientId;
        setPeerCount(data.peers.length);
        // 既に相手がいるなら、自分が演者なら自分から offer を投げる
        const peer = data.peers[0];
        if (peer) {
          peerIdRef.current = peer.clientId;
          if (role === 'performer') {
            await makeOffer();
          }
          // fan 側は performer からの offer を待つ
        } else {
          updateStatus('waiting');
        }
      } else if (data.type === 'peer-joined') {
        peerIdRef.current = data.clientId;
        setPeerCount((c) => c + 1);
        if (role === 'performer') {
          // ファンが後から入ってきた → 演者から offer
          await makeOffer();
        }
      } else if (data.type === 'peer-left') {
        if (peerIdRef.current === data.clientId) {
          peerIdRef.current = null;
        }
        setPeerCount((c) => Math.max(0, c - 1));
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
        if (statusRef.current === 'in-call') {
          updateStatus('waiting');
        }
      } else if (data.type === 'signal') {
        await handleSignal(data.from, data.payload);
      }
    };

    es.onerror = () => {
      // 通常は ended 後の close で発火するので、active な場合のみエラー扱い
      if (statusRef.current !== 'ended') {
        console.warn('[call] SSE error / closed');
      }
    };
  }, [createPeerConnection, handleSignal, makeOffer, role, roomId, updateStatus]);

  // ---------------------------------------------------------------
  // 終了処理
  // ---------------------------------------------------------------
  const hangUp = useCallback(() => {
    try {
      pcRef.current?.close();
    } catch {
      // ignore
    }
    pcRef.current = null;

    try {
      eventSourceRef.current?.close();
    } catch {
      // ignore
    }
    eventSourceRef.current = null;

    const stream = localStreamRef.current;
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
    }
    localStreamRef.current = null;

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    myIdRef.current = null;
    peerIdRef.current = null;
    isOffererRef.current = false;
    setPeerCount(0);
    updateStatus('ended');
  }, [updateStatus]);

  // unmount で必ずクリーンアップ
  useEffect(() => {
    return () => {
      hangUp();
    };
    // hangUp 自体は ref ベースなので依存は空でよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------
  // マイク / カメラ ON-OFF
  // ---------------------------------------------------------------
  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !micOn;
    for (const t of stream.getAudioTracks()) t.enabled = next;
    setMicOn(next);
  }, [micOn]);

  const toggleCam = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !camOn;
    for (const t of stream.getVideoTracks()) t.enabled = next;
    setCamOn(next);
  }, [camOn]);

  // ---------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------
  const inSession = status === 'in-call' || status === 'waiting' || status === 'connecting';

  return (
    <div className="space-y-4">
      <StatusBar
        status={status}
        role={role}
        peerCount={peerCount}
        peerLabel={peerLabel}
      />

      {errorMsg && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          <p>{errorMsg}</p>
        </div>
      )}

      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-900 aspect-video">
        {/* 相手の映像 (大) */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
        {!inSession && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
            <p className="text-sm opacity-80">
              {status === 'ended'
                ? '通話を終了しました'
                : status === 'error'
                  ? 'エラーが発生しました'
                  : '「通話を開始」を押して入室します'}
            </p>
          </div>
        )}
        {inSession && peerCount === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
            <Loader2 className="h-6 w-6 animate-spin opacity-80" aria-hidden />
            <p className="text-sm opacity-80">
              {role === 'performer' ? 'ファンの参加を待っています…' : '演者の参加を待っています…'}
            </p>
          </div>
        )}

        {/* 自分の映像 (小・右下) */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-3 right-3 w-32 rounded-lg border border-white/30 bg-black object-cover shadow-lg sm:w-48"
        />
      </div>

      <div className="flex items-center justify-center gap-3">
        {!inSession ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={status === 'requesting-media'}
            className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === 'requesting-media' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <VideoIcon className="h-4 w-4" aria-hidden />
            )}
            通話を開始
          </button>
        ) : (
          <>
            <IconButton
              label={micOn ? 'マイクをミュート' : 'マイクをオン'}
              onClick={toggleMic}
              tone={micOn ? 'neutral' : 'danger'}
            >
              {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </IconButton>
            <IconButton
              label={camOn ? 'カメラをオフ' : 'カメラをオン'}
              onClick={toggleCam}
              tone={camOn ? 'neutral' : 'danger'}
            >
              {camOn ? <VideoIcon className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </IconButton>
            <IconButton label="通話を終了" onClick={hangUp} tone="hangup">
              <PhoneOff className="h-5 w-5" />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================
// Sub components
// =============================================================
function StatusBar({
  status,
  role,
  peerCount,
  peerLabel,
}: {
  status: Status;
  role: Role;
  peerCount: number;
  peerLabel?: string;
}) {
  const label = (() => {
    switch (status) {
      case 'idle':
        return '待機（未入室）';
      case 'requesting-media':
        return 'カメラ・マイクの許可を待っています…';
      case 'connecting':
        return '接続中…';
      case 'waiting':
        return role === 'performer'
          ? 'ファンの参加を待っています'
          : '演者の参加を待っています';
      case 'in-call':
        return '通話中';
      case 'ended':
        return '通話を終了しました';
      case 'error':
        return 'エラー';
    }
  })();

  const dotColor =
    status === 'in-call'
      ? 'bg-emerald-500'
      : status === 'waiting' || status === 'connecting' || status === 'requesting-media'
        ? 'bg-amber-500'
        : status === 'error'
          ? 'bg-rose-500'
          : 'bg-slate-400';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} aria-hidden />
        <span className="font-medium text-slate-700">{label}</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span>ロール: {role === 'performer' ? '演者' : 'ファン'}</span>
        {peerLabel && <span>相手: {peerLabel}</span>}
        <span>ピア数: {peerCount}</span>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  tone: 'neutral' | 'danger' | 'hangup';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'hangup'
      ? 'bg-rose-600 text-white hover:bg-rose-700'
      : tone === 'danger'
        ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
        : 'bg-slate-100 text-slate-700 hover:bg-slate-200';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-12 w-12 items-center justify-center rounded-full transition-colors ${cls}`}
    >
      {children}
    </button>
  );
}
