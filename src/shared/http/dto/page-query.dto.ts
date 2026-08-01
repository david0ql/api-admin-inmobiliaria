import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 25 })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 25;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
