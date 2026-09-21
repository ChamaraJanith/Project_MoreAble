import { FarePolicy } from '../../../entities/booking/model/types';
import { adminFetch } from './adminHttp';

export async function getFarePolicy(): Promise<FarePolicy> {
    const data = await adminFetch('/api/fare-policy');
    return data.policy as FarePolicy;
}

export async function updateFarePolicy(policy: Partial<FarePolicy>): Promise<FarePolicy> {
    const data = await adminFetch('/api/fare-policy', {
        method: 'PUT',
        body: JSON.stringify(policy),
    });
    return data.policy as FarePolicy;
}

export async function resetFarePolicyToDefaults(): Promise<FarePolicy> {
    const data = await adminFetch('/api/fare-policy', {
        method: 'POST',
        body: JSON.stringify({}),
    });
    return data.policy as FarePolicy;
}
