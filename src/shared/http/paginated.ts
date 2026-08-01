import { ApiProperty } from '@nestjs/swagger';

export class PageMeta {
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() pages: number;
  @ApiProperty() hasNext: boolean;
}

export class Paginated<T> {
  @ApiProperty({ isArray: true })
  data: T[];

  @ApiProperty({ type: PageMeta })
  meta: PageMeta;

  constructor(data: T[], total: number, page: number, limit: number) {
    const pages = limit > 0 ? Math.ceil(total / limit) : 0;
    this.data = data;
    this.meta = { total, page, limit, pages, hasNext: page < pages };
  }
}

export function paginate<T>(
  [data, total]: [T[], number],
  page: number,
  limit: number,
): Paginated<T> {
  return new Paginated(data, total, page, limit);
}
