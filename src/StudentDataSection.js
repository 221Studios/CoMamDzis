import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { displayProfileValue, STUDENT_PROFILE_FIELDS } from './studentProfile';

export function StudentDataSection({ profile, styles, theme }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.studentDataBlock}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((open) => !open)}
        style={({ pressed }) => [styles.menuRowPressable, pressed && styles.menuRowPressed]}
      >
        <View style={styles.menuRow}>
          <Ionicons color={theme.text} name="person-outline" size={24} style={styles.menuIcon} />
          <Text ellipsizeMode="tail" numberOfLines={1} style={styles.menuLabel}>
            Twoje dane
          </Text>
          <View style={styles.menuTrailing}>
            <Ionicons color={theme.mutedText} name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'} size={20} />
          </View>
        </View>
      </Pressable>

      {expanded
        ? STUDENT_PROFILE_FIELDS.map((field) => {
            const rawValue = String(profile?.[field.key] || '').trim();
            return (
              <View key={field.key} style={styles.studentDataRow}>
                <Text style={styles.studentDataLabel}>{field.label}</Text>
                <Text selectable style={styles.studentDataValue}>
                  {displayProfileValue(rawValue)}
                </Text>
              </View>
            );
          })
        : null}
    </View>
  );
}
