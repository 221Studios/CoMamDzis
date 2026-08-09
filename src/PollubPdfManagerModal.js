import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { pollubPdfLabel } from './pollubClient';

const BRAND_GRADIENT = ['#7b1cff', '#2575ff', '#19e6e6'];
const BRAND_GRADIENT_START = { x: 0, y: 1 };
const BRAND_GRADIENT_END = { x: 1, y: 0 };
const BRAND_GRADIENT_TEXT = '#ffffff';

export function PollubPdfManagerModal({
  emptyText = 'Nie dodano jeszcze żadnego PDF.',
  labelPdf = pollubPdfLabel,
  onAddPdf,
  onClose,
  onRemovePdf,
  pdfUris = [],
  subtitle = 'Możesz dodać wiele semestrów',
  theme,
  title = 'PDF planów (POLLUB)',
  visible
}) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const list = Array.isArray(pdfUris) ? pdfUris : [];

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.scrim}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <LinearGradient
              colors={BRAND_GRADIENT}
              end={BRAND_GRADIENT_END}
              start={BRAND_GRADIENT_START}
              style={styles.iconWrap}
            >
              <Ionicons color={BRAND_GRADIENT_TEXT} name="document-text-outline" size={22} />
            </LinearGradient>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <Pressable accessibilityLabel="Zamknij" hitSlop={8} onPress={onClose} style={styles.closeButton}>
              <Ionicons color={theme.text} name="close" size={22} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {list.length ? (
              list.map((uri) => (
                <View key={uri} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text numberOfLines={1} style={styles.rowTitle}>{labelPdf(uri)}</Text>
                    <Text numberOfLines={1} style={styles.rowSubtitle}>{uri}</Text>
                  </View>
                  <Pressable
                    accessibilityLabel="Usuń PDF"
                    hitSlop={8}
                    onPress={() => onRemovePdf?.(uri)}
                    style={({ pressed }) => [styles.rowAction, pressed && styles.rowActionPressed]}
                  >
                    <Ionicons color={theme.mutedText} name="trash-outline" size={20} />
                  </Pressable>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>{emptyText}</Text>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable onPress={onAddPdf} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Dodaj PDF</Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.primaryButton}>
              <LinearGradient
                colors={BRAND_GRADIENT}
                end={BRAND_GRADIENT_END}
                start={BRAND_GRADIENT_START}
                style={styles.primaryGradient}
              >
                <Text style={styles.primaryText}>Gotowe</Text>
              </LinearGradient>
            </Pressable>
          </View>
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
      backgroundColor: theme.surfaceBg,
      borderRadius: 16,
      maxHeight: 520,
      maxWidth: 520,
      padding: 18,
      width: '100%'
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      marginBottom: 12
    },
    iconWrap: {
      alignItems: 'center',
      borderRadius: 12,
      height: 44,
      justifyContent: 'center',
      width: 44
    },
    titleBlock: {
      flex: 1
    },
    title: {
      color: theme.fieldText,
      fontSize: 17,
      fontWeight: '700'
    },
    subtitle: {
      color: theme.mutedText,
      fontSize: 13,
      marginTop: 2
    },
    closeButton: {
      padding: 4
    },
    list: {
      gap: 10,
      paddingBottom: 10
    },
    row: {
      alignItems: 'center',
      backgroundColor: theme.activeBg,
      borderColor: theme.border,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 10,
      padding: 12
    },
    rowText: {
      flex: 1
    },
    rowTitle: {
      color: theme.fieldText,
      fontSize: 14,
      fontWeight: '700'
    },
    rowSubtitle: {
      color: theme.mutedText,
      fontSize: 12,
      marginTop: 3
    },
    rowAction: {
      padding: 6
    },
    rowActionPressed: {
      opacity: 0.7
    },
    emptyText: {
      color: theme.mutedText,
      fontSize: 13,
      lineHeight: 18,
      paddingVertical: 6
    },
    footer: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 10
    },
    secondaryButton: {
      alignItems: 'center',
      backgroundColor: theme.activeBg,
      borderColor: theme.border,
      borderRadius: 12,
      borderWidth: 1,
      flex: 1,
      justifyContent: 'center',
      paddingVertical: 12
    },
    secondaryButtonText: {
      color: theme.fieldText,
      fontSize: 14,
      fontWeight: '700'
    },
    primaryButton: {
      borderRadius: 12,
      flex: 1,
      overflow: 'hidden'
    },
    primaryGradient: {
      alignItems: 'center',
      paddingVertical: 12
    },
    primaryText: {
      color: BRAND_GRADIENT_TEXT,
      fontSize: 14,
      fontWeight: '700'
    }
  });
}
