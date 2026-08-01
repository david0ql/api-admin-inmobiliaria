import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from './modules/iam/decorators';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Estado del servicio y de la base de datos' })
  async check() {
    let database = 'down';
    try {
      await this.db.query('SELECT 1');
      database = 'up';
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
