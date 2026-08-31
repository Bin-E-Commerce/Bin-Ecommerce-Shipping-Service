// File này trả tracking shipment cho đúng owner customer đã được Order Service xác minh.

import { Controller, Get, Headers, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ShippingService } from '../services/shipping.service';

@ApiTags('customer-shipments')
@ApiBearerAuth()
@Controller({ path: 'orders', version: '1' })
export class CustomerShipmentController {
  constructor(private readonly shippingService: ShippingService) {}

  // Customer tracking không nhận ownerId từ query/body; ownerId luôn do Gateway forward.
  @Get(':orderId/tracking')
  getTracking(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Headers('x-user-id') ownerId: string,
  ) {
    return this.shippingService.getForCustomer(orderId, ownerId);
  }
}
