/** Boost quiet Live input without connecting microphone audio to speakers. */
export function prepareLiveMicrophone(input: MediaStream): { stream: MediaStream; dispose(): void } {
  const context = new AudioContext()
  const source = context.createMediaStreamSource(input)
  const gain = context.createGain()
  const compressor = context.createDynamicsCompressor()
  const output = context.createMediaStreamDestination()
  gain.gain.value = 3
  compressor.threshold.value = -12
  compressor.knee.value = 12
  compressor.ratio.value = 8
  compressor.attack.value = 0.003
  compressor.release.value = 0.15
  source.connect(gain).connect(compressor).connect(output)
  void context.resume().catch(() => {})
  return {
    stream: output.stream,
    dispose() {
      input.getTracks().forEach(track => track.stop())
      output.stream.getTracks().forEach(track => track.stop())
      source.disconnect(); gain.disconnect(); compressor.disconnect()
      void context.close().catch(() => {})
    }
  }
}
