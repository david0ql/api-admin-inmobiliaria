import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IamModule } from '../iam/iam.module';
import { PublicModule } from '../public/public.module';
import { AttendanceMark } from './domain/attendance-mark.entity';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';

/**
 * Control de asistencia.
 *
 * Depende de `PublicModule` por una sola cosa: la geocodificacion inversa que
 * ya existia para la web. Resolver la direccion de un fichaje y la de un
 * visitante es el mismo problema, y escribir aqui una segunda copia seria
 * tener dos servicios de terceros que mantener y dos formas de fallar.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AttendanceMark]),
    IamModule,
    PublicModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
