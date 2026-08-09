import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

const BRAND_GRADIENT = ['#7b1cff', '#2575ff', '#19e6e6'];
const BRAND_GRADIENT_START = { x: 0, y: 1 };
const BRAND_GRADIENT_END = { x: 1, y: 0 };
const BRAND_GRADIENT_TEXT = '#ffffff';

export function WszipHelpModal({ onClose, theme, visible }) {
  const modalStyles = useMemo(() => createStyles(theme), [theme]);
  const steps = [
    'Kliknij „Otwórz Moodle (Google)” — otworzy się przeglądarka systemowa.',
    'Zaloguj się kontem Google uczelni (to jedyny sposób logowania WSZiP).',
    'Na stronie głównej Moodle znajdź plan zajęć i pobierz plik PDF na telefon.',
    'Wróć do aplikacji i kliknij „Dodaj PDF planu (opcjonalnie)”.',
    'Jeśli nie masz jeszcze PDF, kliknij „Zaloguj” i dodaj plik później w ustawieniach.'
  ];

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={modalStyles.scrim}>
        <View style={modalStyles.panel}>
          <View style={modalStyles.header}>
            <LinearGradient
              colors={BRAND_GRADIENT}
              end={BRAND_GRADIENT_END}
              start={BRAND_GRADIENT_START}
              style={modalStyles.iconWrap}
            >
              <Ionicons color={BRAND_GRADIENT_TEXT} name="document-text-outline" size={22} />
            </LinearGradient>
            <View style={modalStyles.titleBlock}>
              <Text style={modalStyles.title}>Plan PDF z Moodle WSZiP</Text>
              <Text style={modalStyles.subtitle}>Logowanie Google + wybór pliku</Text>
            </View>
            <Pressable accessibilityLabel="Zamknij instrukcję" hitSlop={8} onPress={onClose} style={modalStyles.closeButton}>
              <Ionicons color={theme.text} name="close" size={22} />
            </Pressable>
          </View>

          <View style={modalStyles.steps}>
            {steps.map((step, index) => (
              <View key={step} style={modalStyles.stepRow}>
                <LinearGradient
                  colors={BRAND_GRADIENT}
                  end={BRAND_GRADIENT_END}
                  start={BRAND_GRADIENT_START}
                  style={modalStyles.stepNumber}
                >
                  <Text style={modalStyles.stepNumberText}>{index + 1}</Text>
                </LinearGradient>
                <Text style={modalStyles.stepText}>{step}</Text>
              </View>
            ))}
          </View>

          <Pressable onPress={onClose} style={modalStyles.actionButton}>
            <LinearGradient
              colors={BRAND_GRADIENT}
              end={BRAND_GRADIENT_END}
              start={BRAND_GRADIENT_START}
              style={modalStyles.actionGradient}
            >
              <Text style={modalStyles.actionText}>Rozumiem</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    scrim: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.45)',
      flex: 1,
      justifyContent: 'center',
      padding: 20
    },
    panel: {
      backgroundColor: theme.screenBg,
      borderRadius: 20,
      maxWidth: 420,
      padding: 18,
      width: '100%'
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      marginBottom: 16
    },
    iconWrap: {
      alignItems: 'center',
      borderRadius: 14,
      height: 44,
      justifyContent: 'center',
      width: 44
    },
    titleBlock: {
      flex: 1
    },
    title: {
      color: theme.text,
      fontFamily: 'Krub-Bold',
      fontSize: 17
    },
    subtitle: {
      color: theme.mutedText,
      fontFamily: 'Krub-Regular',
      fontSize: 13,
      marginTop: 2
    },
    closeButton: {
      padding: 4
    },
    steps: {
      gap: 12,
      marginBottom: 16
    },
    stepRow: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: 10
    },
    stepNumber: {
      alignItems: 'center',
      borderRadius: 12,
      height: 24,
      justifyContent: 'center',
      marginTop: 1,
      width: 24
    },
    stepNumberText: {
      color: BRAND_GRADIENT_TEXT,
      fontFamily: 'Krub-Bold',
      fontSize: 12
    },
    stepText: {
      color: theme.text,
      flex: 1,
      fontFamily: 'Krub-Regular',
      fontSize: 14,
      lineHeight: 20
    },
    actionButton: {
      borderRadius: 24,
      overflow: 'hidden'
    },
    actionGradient: {
      alignItems: 'center',
      height: 44,
      justifyContent: 'center'
    },
    actionText: {
      color: theme.text,
      fontFamily: 'Krub-Bold',
      fontSize: 15
    }
  });
}
