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

export function WatGroupPickerModal({
  groupFilter,
  groups = [],
  groupsError = '',
  groupsLoading = false,
  onClose,
  onConfirm,
  onGroupFilterChange,
  onSelectGroup,
  selectedGroup = '',
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
              <Ionicons color={BRAND_GRADIENT_TEXT} name="people-outline" size={22} />
            </LinearGradient>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>Wybierz grupę</Text>
              <Text style={styles.subtitle}>WML WAT — lista z wml.wat.edu.pl</Text>
            </View>
            <Pressable accessibilityLabel="Zamknij" hitSlop={8} onPress={onClose} style={styles.closeButton}>
              <Ionicons color={theme.text} name="close" size={22} />
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>Grupa</Text>
          <TextInput
            autoCapitalize="characters"
            autoCorrect={false}
            cursorColor={theme.formFocus}
            onChangeText={onGroupFilterChange}
            placeholder="Szukaj grupy, np. WMT24AX1S1"
            placeholderTextColor={theme.mutedText}
            selectionColor={theme.formFocus}
            style={styles.input}
            value={groupFilter}
          />

          {groupsLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={theme.accent} size="small" />
              <Text style={styles.hint}>Ładuję grupy...</Text>
            </View>
          ) : null}

          {groupsError ? <Text style={styles.errorText}>{groupsError}</Text> : null}

          {!groupsLoading && groups.length ? (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.groupList}>
              {groups.map((group) => {
                const active = selectedGroup === group.code;
                return (
                  <Pressable
                    key={group.code}
                    onPress={() => onSelectGroup?.(group)}
                    style={[styles.groupItem, active && styles.groupItemActive]}
                  >
                    <Text style={[styles.groupItemText, active && styles.groupItemTextActive]}>
                      {group.code}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {!groupsLoading && !groupsError && !groups.length ? (
            <Text style={styles.hint}>Brak grup dla tego wydziału.</Text>
          ) : null}

          {selectedGroup ? (
            <Text style={styles.selectedText}>Wybrana grupa: {selectedGroup}</Text>
          ) : null}

          <View style={styles.footer}>
            <Pressable onPress={onClose} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Anuluj</Text>
            </Pressable>
            <Pressable onPress={onConfirm} style={styles.primaryButton}>
              <LinearGradient
                colors={BRAND_GRADIENT}
                end={BRAND_GRADIENT_END}
                start={BRAND_GRADIENT_START}
                style={styles.primaryGradient}
              >
                <Text style={styles.primaryText}>Potwierdź</Text>
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
      gap: 10,
      maxHeight: '88%',
      maxWidth: 520,
      padding: 18,
      width: '100%'
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12
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
    sectionLabel: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '700'
    },
    input: {
      backgroundColor: theme.fieldBg,
      borderColor: theme.border,
      borderRadius: 10,
      borderWidth: 1,
      color: theme.fieldText,
      fontSize: 14,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    loadingRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8
    },
    hint: {
      color: theme.mutedText,
      fontSize: 13
    },
    errorText: {
      color: '#cf2e2e',
      fontSize: 13
    },
    groupList: {
      borderColor: theme.border,
      borderRadius: 10,
      borderWidth: 1,
      maxHeight: 220
    },
    groupItem: {
      borderBottomColor: theme.divider,
      borderBottomWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    groupItemActive: {
      backgroundColor: theme.surfaceBgActive
    },
    groupItemText: {
      color: theme.text,
      fontSize: 14
    },
    groupItemTextActive: {
      color: theme.accent,
      fontWeight: '700'
    },
    selectedText: {
      color: theme.accent,
      fontSize: 13,
      fontWeight: '700'
    },
    footer: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 4
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
