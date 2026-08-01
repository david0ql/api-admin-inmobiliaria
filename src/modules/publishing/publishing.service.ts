import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Portal } from '../catalog/domain/catalogs.entity';
import { PropertiesService } from '../properties/properties.service';
import {
  PropertyPublication,
  PublicationState,
} from './domain/property-publication.entity';
import type {
  SetPublicationsDto,
  UpdatePublicationDto,
} from './publishing.dto';

@Injectable()
export class PublishingService {
  constructor(
    @InjectRepository(PropertyPublication)
    private readonly repo: Repository<PropertyPublication>,
    @InjectRepository(Portal) private readonly portals: Repository<Portal>,
    private readonly properties: PropertiesService,
  ) {}

  async listForProperty(propertyId: string): Promise<PropertyPublication[]> {
    if (!(await this.properties.exists(propertyId))) {
      throw new NotFoundException(`Inmueble ${propertyId} no encontrado`);
    }
    return this.repo.find({
      where: { propertyId },
      order: { portalId: 'ASC' },
    });
  }

  /**
   * Fija el conjunto de portales del inmueble. Es idempotente: los que ya
   * estaban se conservan con su fecha de publicacion — reenviar la misma lista
   * no debe reiniciar la antiguedad del anuncio — y los que desaparecen se
   * retiran.
   */
  async setPublications(
    propertyId: string,
    dto: SetPublicationsDto,
  ): Promise<PropertyPublication[]> {
    if (!(await this.properties.exists(propertyId))) {
      throw new NotFoundException(`Inmueble ${propertyId} no encontrado`);
    }

    const wanted = [...new Set(dto.portalIds)];
    if (wanted.length) {
      const found = await this.portals.count({ where: { id: In(wanted) } });
      if (found !== wanted.length) {
        throw new BadRequestException(
          'Alguno de los portales enviados no existe',
        );
      }
    }

    const current = await this.repo.find({ where: { propertyId } });
    const currentIds = new Set(current.map((p) => p.portalId));

    const toRemove = current.filter((p) => !wanted.includes(p.portalId));
    if (toRemove.length) await this.repo.remove(toRemove);

    const toAdd = wanted.filter((id) => !currentIds.has(id));
    if (toAdd.length) {
      await this.repo.save(
        toAdd.map((portalId) =>
          this.repo.create({
            propertyId,
            portalId,
            state: PublicationState.PENDING,
          }),
        ),
      );
    }

    return this.listForProperty(propertyId);
  }

  async updateOne(
    propertyId: string,
    portalId: number,
    dto: UpdatePublicationDto,
  ): Promise<PropertyPublication> {
    const publication = await this.repo.findOne({
      where: { propertyId, portalId },
    });
    if (!publication) {
      throw new NotFoundException('El inmueble no esta asociado a ese portal');
    }

    if (dto.state) {
      publication.state = dto.state;
      // La fecha de publicacion se sella la primera vez que el portal confirma.
      if (
        dto.state === PublicationState.PUBLISHED &&
        !publication.publishedAt
      ) {
        publication.publishedAt = new Date();
      }
    }
    if (dto.note !== undefined) publication.note = dto.note ?? null;
    if (dto.externalUrl !== undefined)
      publication.externalUrl = dto.externalUrl ?? null;

    return this.repo.save(publication);
  }

  /** Cobertura por portal: cuantos inmuebles hay en cada uno y en que estado. */
  async coverage(): Promise<
    {
      portalId: number;
      portal: string;
      paid: boolean;
      total: number;
      published: number;
    }[]
  > {
    return this.repo
      .createQueryBuilder('pub')
      .innerJoin('pub.portal', 'portal')
      .select('portal.id', 'portalId')
      .addSelect('portal.name', 'portal')
      .addSelect('portal.paid', 'paid')
      .addSelect('COUNT(*)::int', 'total')
      .addSelect(
        `COUNT(*) FILTER (WHERE pub.state = '${PublicationState.PUBLISHED}')::int`,
        'published',
      )
      .groupBy('portal.id')
      .addGroupBy('portal.name')
      .addGroupBy('portal.paid')
      .orderBy('total', 'DESC')
      .getRawMany();
  }

  /**
   * Inmuebles activos que no estan en ningun portal: dinero parado. Es la
   * consulta que en WASI habia que reconstruir a mano inmueble por inmueble.
   */
  async unpublishedActiveProperties(): Promise<
    { id: string; code: string; title: string }[]
  > {
    return this.repo.manager
      .createQueryBuilder()
      .select(['p.id AS id', 'p.code AS code', 'p.title AS title'])
      .from('property', 'p')
      .where("p.publication_status IN ('ACTIVE','OUTSTANDING')")
      .andWhere('p.deleted_at IS NULL')
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM property_publication pp WHERE pp.property_id = p.id)',
      )
      .orderBy('p.created_at', 'DESC')
      .getRawMany();
  }
}
