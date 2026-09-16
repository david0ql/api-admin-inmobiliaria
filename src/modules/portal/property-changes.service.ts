import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { PropertyInterest, InterestRole } from '../crm/domain/property-interest.entity';
import { Property } from '../properties/domain/property.entity';
import { PublicationStatus } from '../properties/domain/property.enums';
import type { PortalPropertyUpdateDto } from './dto/portal.dto';
import {
  PortalChangeSettings,
  PropertyChangeAction,
  PropertyChangeRequest,
  PropertyChangeStatus,
} from './domain/property-change-request.entity';

const EDITABLE = [
  'address', 'salePrice', 'rentPrice', 'maintenanceFee', 'area', 'builtArea',
  'privateArea', 'bedrooms', 'bathrooms', 'garages',
] as const;

@Injectable()
export class PropertyChangesService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(
    @InjectRepository(PropertyChangeRequest) private readonly changes: Repository<PropertyChangeRequest>,
    @InjectRepository(PortalChangeSettings) private readonly settings: Repository<PortalChangeSettings>,
    @InjectRepository(PropertyInterest) private readonly interests: Repository<PropertyInterest>,
    @InjectRepository(Property) private readonly properties: Repository<Property>,
  ) {}

  onModuleInit() {
    void this.applyDue();
    this.timer = setInterval(() => void this.applyDue(), 30_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async own(clientId: string) {
    return this.changes.find({ where: { clientId }, order: { createdAt: 'DESC' } });
  }
  async all() {
    return this.changes.find({ order: { createdAt: 'DESC' }, take: 250 });
  }

  async proposeUpdate(clientId: string, propertyId: string, dto: PortalPropertyUpdateDto) {
    const property = await this.ownedProperty(clientId, propertyId);
    await this.ensureNoPending(clientId, propertyId);
    const before = snapshot(property);
    const after: Record<string, unknown> = {};
    for (const key of EDITABLE) if (dto[key] !== undefined) after[key] = dto[key];
    if (!Object.keys(after).length) throw new ConflictException('No hay cambios para enviar');
    return this.changes.save(this.changes.create({
      clientId, propertyId, action: PropertyChangeAction.UPDATE,
      status: PropertyChangeStatus.PENDING, beforeValues: before, afterValues: after,
    }));
  }

  async proposeArchive(clientId: string, propertyId: string) {
    const property = await this.ownedProperty(clientId, propertyId);
    await this.ensureNoPending(clientId, propertyId);
    return this.changes.save(this.changes.create({
      clientId, propertyId, action: PropertyChangeAction.ARCHIVE,
      status: PropertyChangeStatus.PENDING,
      beforeValues: snapshot(property), afterValues: { archived: true },
    }));
  }

  /** Única acción inmediata solicitada por el propietario. */
  async deactivate(clientId: string, propertyId: string) {
    await this.ownedProperty(clientId, propertyId);
    await this.properties.update({ id: propertyId }, { publicationStatus: PublicationStatus.INACTIVE });
    return { publicationStatus: PublicationStatus.INACTIVE };
  }

  async review(id: string, approved: boolean, actorId: string, resolution?: string) {
    const change = await this.changes.findOne({ where: { id } });
    if (!change) throw new NotFoundException('Solicitud no encontrada');
    if (change.status !== PropertyChangeStatus.PENDING) {
      throw new ConflictException('La solicitud ya fue revisada');
    }
    const setting = await this.getSettings();
    change.status = approved ? PropertyChangeStatus.APPROVED : PropertyChangeStatus.REJECTED;
    change.reviewedByAgentId = actorId;
    change.reviewedAt = new Date();
    change.resolution = resolution?.trim() || null;
    change.applyAfter = approved
      ? new Date(Date.now() + setting.propagationMinutes * 60_000)
      : null;
    await this.changes.save(change);
    if (approved && setting.propagationMinutes === 0) await this.applyDue();
    return change;
  }

  async getSettings() {
    return (await this.settings.find({ order: { createdAt: 'ASC' }, take: 1 }))[0]
      ?? this.settings.save(this.settings.create({ propagationMinutes: 5 }));
  }
  async updateSettings(propagationMinutes: number) {
    const settings = await this.getSettings();
    settings.propagationMinutes = propagationMinutes;
    return this.settings.save(settings);
  }

  async applyDue() {
    const due = await this.changes.find({
      where: { status: PropertyChangeStatus.APPROVED, applyAfter: LessThanOrEqual(new Date()) },
      take: 100,
    });
    for (const change of due) {
      if (change.action === PropertyChangeAction.ARCHIVE) {
        await this.properties.softDelete(change.propertyId);
      } else {
        const allowed: Record<string, unknown> = {};
        for (const key of EDITABLE) if (change.afterValues[key] !== undefined) allowed[key] = change.afterValues[key];
        await this.properties.update({ id: change.propertyId }, allowed);
      }
      change.status = PropertyChangeStatus.APPLIED;
      change.appliedAt = new Date();
      await this.changes.save(change);
    }
  }

  private async ownedProperty(clientId: string, propertyId: string) {
    const link = await this.interests.findOne({
      where: { clientId, propertyId, role: InterestRole.OWNER },
      loadEagerRelations: false,
    });
    if (!link) throw new NotFoundException('Inmueble no encontrado');
    const property = await this.properties.findOne({ where: { id: propertyId }, loadEagerRelations: false });
    if (!property) throw new NotFoundException('Inmueble no encontrado');
    return property;
  }
  private async ensureNoPending(clientId: string, propertyId: string) {
    const pending = await this.changes.findOne({
      where: [
        { clientId, propertyId, status: PropertyChangeStatus.PENDING },
        { clientId, propertyId, status: PropertyChangeStatus.APPROVED },
      ],
    });
    if (pending) throw new ConflictException('Ya hay una solicitud pendiente para este inmueble');
  }
}

function snapshot(property: Property): Record<string, unknown> {
  const values: Record<string, unknown> = { title: property.title, code: property.code };
  for (const key of EDITABLE) values[key] = property[key];
  return values;
}
