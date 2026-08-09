import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

const BRAND_GRADIENT = ['#7b1cff', '#2575ff', '#19e6e6'];
const BRAND_GRADIENT_START = { x: 0, y: 1 };
const BRAND_GRADIENT_END = { x: 1, y: 0 };
const BRAND_GRADIENT_TEXT = '#ffffff';

export function WseitContextPickerModal({
  contextFilter,
  contexts = [],
  contextsError = '',
  contextsLoading = false,
  onClose,
  onConfirm,
  onContextFilterChange,
  onSelectContext,
  selectedContextId = '',
  theme,
  visible
}) {
  const styles = useMemo(() => createStyles(theme), [theme]);

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
              <Ionicons color={BRAND_GRADIENT_TEXT} name="school-outline" size={22} />
            </LinearGradient>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>Wybierz profil studiów</Text>
              <Text style={styles.subtitle}>WSEIT — wd.wseit.pl</Text>
            </View>
            <Pressable accessibilityLabel="Zamknij" hitSlop={8} onPress={onClose} style={styles.closeButton}>
              <Ionicons color={theme.text} name="close" size={22} />
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>Profil</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            cursorColor={theme.formFocus}
            onChangeText={onContextFilterChange}
            placeholder="Szukaj kierunku, np. Kosmetologia"
            placeholderTextColor={theme.mutedText}
            selectionColor={theme.formFocus}
            style={styles.input}
            value={contextFilter}
          />

          {contextsLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={theme.accent} size="small" />
              <Text style={styles.hint}>Ładuję profile studiów...</Text>
            </View>
          ) : null}

          {contextsError ? <Text style={styles.errorText}>{contextsError}</Text> : null}

          {!contextsLoading && contexts.length ? (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
              {contexts.map((context) => {
                const active = selectedContextId === context.id;
                return (
                  <Pressable
                    key={context.id}
                    onPress={() => onSelectContext(context)}
                    style={({ pressed }) => [
                      styles.item,
                      active && styles.itemActive,
                      pressed && styles.itemPressed
                    ]}
                  >
                    <Text style={[styles.itemText, active && styles.itemTextActive]}>{context.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {!contextsLoading && !contexts.length && !contextsError ? (
            <Text style={styles.hint}>Brak profili do wyboru. Sprawdź login i hasło.</Text>
          ) : null}

          <Pressable
            disabled={!selectedContextId || contextsLoading}
            onPress={onConfirm}
            style={({ pressed }) => [
              styles.confirmButton,
              (!selectedContextId || contextsLoading) && styles.confirmButtonDisabled,
              pressed && selectedContextId && !contextsLoading && styles.confirmButtonPressed
            ]}
          >
            <Text style={styles.confirmButtonText}>Potwierdź wybór</Text>
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
      backgroundColor: 'rgba(0,0,0,0.55)',
      flex: 1,
      justifyContent: 'center',
      padding: 20
    },
    panel: {
      backgroundColor: theme.cardBg,
      borderRadius: 18,
      maxHeight: '85%',
      padding: 18,
      width: '100%'
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      marginBottom: 14
    },
    iconWrap: {
      alignItems: 'center',
      borderRadius: 12,
      height: 42,
      justifyContent: 'center',
      width: 42
    },
    titleBlock: {
      flex: 1
    },
    title: {
      color: theme.text,
      fontFamily: 'Poppins_600SemiBold',
      fontSize: 18
    },
    subtitle: {
      color: theme.mutedText,
      fontFamily: 'Poppins_400Regular',
      fontSize: 13,
      marginTop: 2
    },
    closeButton: {
      padding: 4
    },
    sectionLabel: {
      color: theme.mutedText,
      fontFamily: 'Poppins_500Medium',
      fontSize: 13,
      marginBottom: 6
    },
    input: {
      backgroundColor: theme.formBg,
      borderColor: theme.formBorder,
      borderRadius: 12,
      borderWidth: 1,
      color: theme.text,
      fontFamily: 'Poppins_400Regular',
      marginBottom: 12,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    loadingRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      marginBottom: 10
    },
    hint: {
      color: theme.mutedText,
      fontFamily: 'Poppins_400Regular',
      fontSize: 13,
      marginBottom: 10
    },
    errorText: {
      color: theme.danger || '#d64545',
      fontFamily: 'Poppins_400Regular',
      fontSize: 13,
      marginBottom: 10
    },
    list: {
      maxHeight: 260,
      marginBottom: 14
    },
    item: {
      backgroundColor: theme.formBg,
      borderColor: theme.formBorder,
      borderRadius: 12,
      borderWidth: 1,
      marginBottom: 8,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    itemActive: {
      borderColor: theme.accent,
      backgroundColor: theme.accentSoft || theme.formBg
    },
    itemPressed: {
      opacity: 0.85
    },
    itemText: {
      color: theme.text,
      fontFamily: 'Poppins_400Regular',
      fontSize: 14
    },
    itemTextActive: {
      color: theme.accent,
      fontFamily: 'Poppins_600SemiBold'
    },
    confirmButton: {
      alignItems: 'center',
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingVertical: 14
    },
    confirmButtonDisabled: {
      opacity: 0.45
    },
    confirmButtonPressed: {
      opacity: 0.9
    },
    confirmButtonText: {
      color: '#fff',
      fontFamily: 'Poppins_600SemiBold',
      fontSize: 15
    }
  });
}
