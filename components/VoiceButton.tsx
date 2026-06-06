// TODO: implement voice button — ElevenLabs STT/TTS front-end

type VoiceButtonProps = {
  onTranscript: (text: string) => void;
};

export function VoiceButton(_props: VoiceButtonProps): React.ReactElement {
  return <button type="button">Voice not implemented</button>;
}
