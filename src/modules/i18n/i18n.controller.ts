import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { Public, Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import { PublicCache } from '../../shared/cache/public-cache.decorator';
import { I18nService } from './i18n.service';
import { LOCALES, type Locale } from './domain/translation.entity';

class SetTranslationDto {
  @IsString()
  @MaxLength(4000)
  value: string;
}

@ApiTags('i18n')
@Controller()
export class I18nController {
  constructor(private readonly i18n: I18nService) {}

  /*
    Publico y cacheado: es lo primero que pide la web al arrancar, en cada
    visita y en los dos idiomas.
  */
  @Public()
  @PublicCache(300)
  @Get('public/i18n/:locale')
  @ApiOperation({
    summary: 'Las frases de la web en un idioma',
    description:
      'El texto del repositorio con encima lo que la agencia haya cambiado desde el panel.',
  })
  dictionary(@Param('locale') locale: string) {
    return this.i18n.dictionary(this.valido(locale));
  }

  /*
    Y el editor, solo para ADMIN: cambiar una frase cambia lo que lee cualquiera
    que entre en la web.
  */
  @Roles(Role.ADMIN)
  @Get('i18n/entries')
  @ApiOperation({ summary: 'Todas las claves, con su texto en los dos idiomas' })
  entries(
    @Query('q') q?: string,
    @Query('missing') missing?: string,
    @Query('edited') edited?: string,
  ) {
    return this.i18n.entries({
      q,
      missing: missing === 'true',
      edited: edited === 'true',
    });
  }

  @Roles(Role.ADMIN)
  @Put('i18n/:locale/:key')
  @ApiOperation({
    summary: 'Cambiar una frase',
    description: 'Con el texto vacio se vuelve a la original del repositorio.',
  })
  async set(
    @Param('locale') locale: string,
    @Param('key') key: string,
    @Body() dto: SetTranslationDto,
  ) {
    await this.i18n.set(this.valido(locale), key, dto.value);
    return { ok: true };
  }

  private valido(locale: string): Locale {
    if (!LOCALES.includes(locale as Locale)) {
      throw new BadRequestException(
        `Idioma "${locale}" no soportado. Los que hay: ${LOCALES.join(', ')}.`,
      );
    }
    return locale as Locale;
  }
}
