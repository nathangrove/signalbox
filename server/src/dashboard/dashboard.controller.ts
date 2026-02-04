import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async get(@Req() req: any) {
    const userId = req.user.sub;
    return this.svc.getDashboardForUser(userId);
  }
}

export default DashboardController;
