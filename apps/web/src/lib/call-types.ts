/**
 * WebRTC シグナリングのメッセージ型
 *
 * - offer / answer は RTCSessionDescriptionInit の sdp 部分を JSON で送る
 * - ice は RTCIceCandidateInit を送る
 */

export type SignalMessage =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit | null };
