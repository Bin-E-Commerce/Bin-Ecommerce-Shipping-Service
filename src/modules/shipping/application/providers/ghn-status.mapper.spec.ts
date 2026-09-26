// Kiểm thử mapping trạng thái GHN sang canonical status của Shipping Service.

/// <reference types="jest" />

import { ShipmentStatus } from '@/database/enums/shipment-status.enum';
import { normalizeGhnStatus } from '@/modules/shipping/application/providers/ghn-status.mapper';

describe('normalizeGhnStatus', () => {
    it('should map GHN delivery statuses to canonical statuses', () => {
        // Arrange
        const cases = [
            ['ready_to_pick', ShipmentStatus.READY_TO_SHIP],
            ['picking', ShipmentStatus.PICKUP_ASSIGNED],
            ['picked', ShipmentStatus.PICKED_UP],
            ['transporting', ShipmentStatus.IN_TRANSIT],
            ['delivered', ShipmentStatus.DELIVERED],
            ['returning', ShipmentStatus.RETURNING],
            ['returned', ShipmentStatus.RETURNED],
            ['cancel', ShipmentStatus.CANCELLED],
        ] as const;

        // Act
        const result = cases.map(
            ([status]) => normalizeGhnStatus(status, null).canonicalStatus,
        );

        // Assert
        expect(result).toEqual(cases.map(([, expected]) => expected));
    });

    it('should keep canonical status unchanged for an unknown provider status', () => {
        // Arrange
        const reason = 'GHN status mới';

        // Act
        const result = normalizeGhnStatus('new_status', reason);

        // Assert
        expect(result).toEqual({ canonicalStatus: null, reason });
    });
});
