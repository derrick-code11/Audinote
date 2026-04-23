/** Deterministic S3 keys for merged lecture audio and per-chunk segments */
export function mergedAudioKey(userId: string, lectureId: string): string {
  return `lectures/${userId}/${lectureId}/derived/merged.wav`;
}

export function segmentAudioKey(userId: string, lectureId: string, chunkIndex: number): string {
  const idx = String(chunkIndex).padStart(4, "0");
  return `lectures/${userId}/${lectureId}/derived/segments/${idx}.wav`;
}
