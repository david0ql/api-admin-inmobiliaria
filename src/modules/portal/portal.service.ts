import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Client } from '../crm/domain/client.entity';
import {
  InterestRole,
  PropertyInterest,
} from '../crm/domain/property-interest.entity';
import { Property } from '../properties/domain/property.entity';
import { Appointment } from '../scheduling/domain/appointment.entity';
import { Agent } from '../iam/domain/agent.entity';
import { ConsignmentRequest } from '../public/domain/consignment-request.entity';

/**
 * Lo que un propietario ve de si mismo.
 *
 * Regla unica y sin excepciones: **todo se acota por el id del token**. Ningun
 * metodo de aqui recibe un `clientId` desde la peticion, porque el dia que uno
 * lo hiciera bastaria cambiar un numero en la URL para leer la cartera ajena.
 *
 * Y lo que sale esta recortado a mano, campo a campo. Devolver la entidad
 * entera filtrando "lo sensible" es la forma habitual de filtrar de mas: la
 * ficha de un inmueble lleva el asesor asignado, las notas internas y el
 * historico de precios, y ninguno de los tres es asunto del propietario.
 */
@Injectable()
export class PortalService {
  constructor(
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    @InjectRepository(PropertyInterest)
    private readonly interests: Repository<PropertyInterest>,
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    @InjectRepository(Agent) private readonly agents: Repository<Agent>,
    @InjectRepository(ConsignmentRequest)
    private readonly consignments: Repository<ConsignmentRequest>,
  ) {}

  /** El perfil del cliente y su asesor, tal y como puede verlos el. */
  async profile(clientId: string) {
    const client = await this.clients.findOne({
      where: { id: clientId },
      loadEagerRelations: false,
      relations: { city: true },
    });
    if (!client) throw new NotFoundException('Cuenta no encontrada');

    return {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      fullName: client.fullName,
      email: client.email,
      cellPhone: client.cellPhone,
      identification: client.identification,
      city: client.city ? { id: client.city.id, name: client.city.name } : null,
      acceptsMarketing: client.acceptsMarketing,
      mustChangePassword: client.mustChangePassword,
      lastPortalLoginAt: client.lastPortalLoginAt,
      agent: await this.agentCard(client.assignedAgentId),
    };
  }

  /**
   * Los inmuebles del cliente: aquellos en los que consta como propietario.
   * `PROSPECT` no cuenta — interesarse por un inmueble no da derecho a ver su
   * ficha de gestion.
   */
  async properties(clientId: string) {
    const owned = await this.interests.find({
      where: { clientId, role: InterestRole.OWNER },
      loadEagerRelations: false,
      select: { propertyId: true },
    });
    const ids = owned.map((interest) => interest.propertyId);
    if (!ids.length) return [];

    const properties = await this.propertyRepo.find({
      where: { id: In(ids) },
      relations: { images: true, propertyType: true, city: true, zone: true },
      order: { createdAt: 'DESC' },
    });

    return properties.map((property) => ({
      id: property.id,
      code: property.code,
      title: property.title,
      address: property.address,
      salePrice: property.salePrice,
      rentPrice: property.rentPrice,
      area: property.area,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      garages: property.garages,
      availability: property.availability,
      publicationStatus: property.publicationStatus,
      propertyType: property.propertyType?.name ?? null,
      city: property.city?.name ?? null,
      zone: property.zone?.name ?? null,
      cover:
        property.images?.find((image) => image.isMain)?.url ??
        property.images?.[0]?.url ??
        null,
      createdAt: property.createdAt,
    }));
  }

  /**
   * Las visitas a sus inmuebles.
   *
   * Se enseña cuando, en cual y en que estado, y nada mas. Ni quien vino, ni su
   * telefono, ni lo que el asesor apunto despues: eso son datos de un tercero y
   * notas internas de la agencia.
   */
  async visits(clientId: string) {
    const owned = await this.interests.find({
      where: { clientId, role: InterestRole.OWNER },
      loadEagerRelations: false,
      select: { propertyId: true },
    });
    const ids = owned.map((interest) => interest.propertyId);
    if (!ids.length) return [];

    const appointments = await this.appointments.find({
      where: { propertyId: In(ids) },
      loadEagerRelations: false,
      order: { startsAt: 'DESC' },
      take: 100,
    });

    const properties = await this.propertyRepo.find({
      where: { id: In(ids) },
      loadEagerRelations: false,
      select: { id: true, code: true, title: true },
    });
    const byId = new Map(properties.map((property) => [property.id, property]));

    return appointments.map((appointment) => ({
      id: appointment.id,
      type: appointment.type,
      status: appointment.status,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      property: byId.get(appointment.propertyId ?? '')
        ? {
            code: byId.get(appointment.propertyId as string)!.code,
            title: byId.get(appointment.propertyId as string)!.title,
          }
        : null,
    }));
  }

  /** Sus solicitudes de consignacion y en que van. */
  async requests(clientId: string, email: string | null) {
    /*
     * Se buscan por `clientId` —lo normal a partir de ahora— y tambien por el
     * correo, para que las solicitudes que envio antes de tener cuenta
     * aparezcan. El correo solo se usa si esta verificado como suyo: viene de
     * su propia ficha, no de la peticion.
     */
    const qb = this.consignments
      .createQueryBuilder('request')
      .where('request.client_id = :clientId', { clientId });

    if (email) {
      qb.orWhere('LOWER(request.owner_email) = :email', {
        email: email.toLowerCase(),
      });
    }

    const requests = await qb
      .orderBy('request.created_at', 'DESC')
      .take(100)
      .getMany();

    return requests.map((request) => ({
      id: request.id,
      reference: request.reference,
      status: request.status,
      complexName: request.complexName,
      address: request.address,
      unitNumber: request.unitNumber,
      cityName: request.cityName,
      neighborhood: request.neighborhood,
      propertyTypeName: request.propertyTypeName,
      salePrice: request.salePrice,
      builtArea: request.builtArea,
      bedrooms: request.bedrooms,
      bathrooms: request.bathrooms,
      requestedVisitAt: request.requestedVisitAt,
      // `resolution` NO sale: son las notas con las que el equipo decide.
      documents: request.files
        .filter((file) => file.kind === 'DOCUMENT')
        .map((file) => ({ docType: file.docType ?? null })),
      photos: request.files.filter((file) => file.kind === 'PHOTO').length,
      propertyId: request.propertyId,
      createdAt: request.createdAt,
    }));
  }

  /**
   * Una solicitud suya, o nada.
   *
   * La comprobacion de pertenencia va aqui y no en el controlador para que no
   * se pueda olvidar: quien quiera una solicitud del portal pasa por este
   * metodo, y este metodo exige el `clientId` del token.
   */
  async ownRequest(
    clientId: string,
    email: string | null,
    requestId: string,
  ): Promise<ConsignmentRequest> {
    const qb = this.consignments
      .createQueryBuilder('request')
      .where('request.id = :requestId', { requestId })
      .andWhere('request.client_id = :clientId', { clientId });

    if (email) {
      qb.orWhere(
        'request.id = :requestId AND LOWER(request.owner_email) = :email',
        { requestId, email: email.toLowerCase() },
      );
    }

    const request = await qb.getOne();
    // Mismo 404 para "no existe" y "no es tuya": distinguirlos diria que
    // solicitud existe con solo probar identificadores.
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    return request;
  }

  /**
   * El asesor a cargo, recortado a la tarjeta de contacto que la agencia ya
   * publica en cada anuncio.
   */
  private async agentCard(agentId: string | null) {
    if (!agentId) return null;
    const agent = await this.agents.findOne({
      where: { id: agentId },
      loadEagerRelations: false,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        cellPhone: true,
        hasWhatsapp: true,
        photoUrl: true,
      },
    });
    if (!agent) return null;

    return {
      fullName: agent.fullName,
      email: agent.email,
      cellPhone: agent.cellPhone,
      hasWhatsapp: agent.hasWhatsapp,
      photoUrl: agent.photoUrl,
    };
  }
}
