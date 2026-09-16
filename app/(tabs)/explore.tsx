import { useTranslation } from 'react-i18next';
//Explore screen of tab

import { AppText as Text } from '../../src/shared/ui/AppText';
import React from 'react';
import { StyleSheet,  View } from 'react-native';

export default function ExploreScreen() {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('explore.title', 'Explore')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
});

