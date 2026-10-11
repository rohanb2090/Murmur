import { useState, useEffect, useCallback } from 'react';

interface VoiceCaptureProps {
  onTranscriptReady: (transcript: string) => void;
}

export function useVoiceCapture({ onTranscriptReady }: VoiceCaptureProps) {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [isSupported, setIsSupported] = useState(false);
  const [recognitionInstance, setRecognitionInstance] = useState<any>(null);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    setIsSupported(true);
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN'; // Optimized for Indian English & Hinglish phonetics
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let currentInterim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const final = event.results[i][0].transcript;
          setInterimText('');
          setIsListening(false);
          onTranscriptReady(final);
        } else {
          currentInterim += event.results[i][0].transcript;
          setInterimText(currentInterim);
        }
      }
    };

    recognition.onerror = (e: any) => {
      console.warn('Speech recognition error:', e);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    setRecognitionInstance(recognition);
  }, [onTranscriptReady]);

  const startListening = useCallback(() => {
    if (!recognitionInstance) return;
    try {
      if (typeof window !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(35);
      }
      setIsListening(true);
      recognitionInstance.start();
    } catch (err) {
      console.warn('Recognition start caught error:', err);
    }
  }, [recognitionInstance]);

  const stopListening = useCallback(() => {
    if (!recognitionInstance) return;
    try {
      recognitionInstance.stop();
    } catch (err) {
      console.warn('Recognition stop caught error:', err);
    }
    setIsListening(false);
  }, [recognitionInstance]);

  return { isListening, interimText, isSupported, startListening, stopListening };
}