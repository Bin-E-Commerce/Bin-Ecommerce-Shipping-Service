// API master data GHN do Shipping Service sở hữu và che giấu credential với frontend.

import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ShippingService } from '@/modules/shipping/application/services/shipping.service';

@Controller('shipping/locations')
export class GhnLocationController {
    constructor(private readonly shippingService: ShippingService) {}

    // Trả danh sách tỉnh/thành phố đã chuẩn hóa từ GHN.
    @Get('provinces')
    listProvinces() {
        return this.shippingService.listGhnProvinces();
    }

    // Trả danh sách quận/huyện theo mã tỉnh GHN.
    @Get('districts')
    listDistricts(@Query('provinceId', ParseIntPipe) provinceId: number) {
        return this.shippingService.listGhnDistricts(provinceId);
    }

    // Trả danh sách phường/xã theo mã quận/huyện GHN.
    @Get('wards')
    listWards(@Query('districtId', ParseIntPipe) districtId: number) {
        return this.shippingService.listGhnWards(districtId);
    }
}
