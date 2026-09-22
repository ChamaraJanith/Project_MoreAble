/**
 * Caregiver UI Components & Interaction Test Suite (MOV-227 / MOV-229)
 * Tests CaregiverActiveTripBanner rendering, interactions, accessibility, and modal triggers.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CaregiverActiveTripBanner } from '../../../src/features/caregiver/ui/CaregiverActiveTripBanner';

// Mock Modal child component to isolate banner behavior
jest.mock('../../../src/features/caregiver/ui/CaregiverSafetyCenterModal', () => ({
  CaregiverSafetyCenterModal: ({ visible, onClose, passengerId, passengerName }: any) => {
    if (!visible) return null;
    const { View, Text, TouchableOpacity } = require('react-native');
    return (
      <View testID="caregiver-modal-mock">
        <Text testID="modal-passenger-id">{passengerId}</Text>
        <Text testID="modal-passenger-name">{passengerName}</Text>
        <TouchableOpacity testID="modal-close-btn" onPress={onClose}>
          <Text>Close Modal</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

describe('Caregiver UI Components - CaregiverActiveTripBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders active safety sharing banner state correctly', () => {
    const { getByText, queryByText } = render(
      <CaregiverActiveTripBanner
        passengerId="PAS-TEST-100"
        passengerName="Kavindu Perera"
        isSharingActive={true}
      />
    );

    expect(getByText('Caregiver Safety Sharing Active')).toBeTruthy();
    expect(getByText('Real-time SMS, Email & GPS tracking enabled')).toBeTruthy();
    expect(getByText('Manage')).toBeTruthy();
    expect(queryByText('Caregiver Sharing Paused')).toBeNull();
  });

  it('renders paused sharing state when isSharingActive is false', () => {
    const { getByText, queryByText } = render(
      <CaregiverActiveTripBanner
        passengerId="PAS-TEST-100"
        passengerName="Kavindu Perera"
        isSharingActive={false}
      />
    );

    expect(getByText('Caregiver Sharing Paused')).toBeTruthy();
    expect(getByText('Tap to manage permissions or resume')).toBeTruthy();
    expect(queryByText('Caregiver Safety Sharing Active')).toBeNull();
  });

  it('opens CaregiverSafetyCenterModal when banner button is pressed', () => {
    const { getByRole, getByTestId, queryByTestId } = render(
      <CaregiverActiveTripBanner
        passengerId="PAS-TEST-200"
        passengerName="Anusha Fernando"
        isSharingActive={true}
      />
    );

    expect(queryByTestId('caregiver-modal-mock')).toBeNull();

    const bannerButton = getByRole('button');
    fireEvent.press(bannerButton);

    expect(getByTestId('caregiver-modal-mock')).toBeTruthy();
    expect(getByTestId('modal-passenger-id').props.children).toBe('PAS-TEST-200');
    expect(getByTestId('modal-passenger-name').props.children).toBe('Anusha Fernando');
  });

  it('closes modal when close button is pressed inside modal', () => {
    const { getByRole, getByTestId, queryByTestId } = render(
      <CaregiverActiveTripBanner
        passengerId="PAS-TEST-200"
        passengerName="Anusha Fernando"
        isSharingActive={true}
      />
    );

    fireEvent.press(getByRole('button'));
    expect(getByTestId('caregiver-modal-mock')).toBeTruthy();

    fireEvent.press(getByTestId('modal-close-btn'));
    expect(queryByTestId('caregiver-modal-mock')).toBeNull();
  });
});
