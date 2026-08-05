const { BooleanField, NumberField, SchemaField } = foundry.data.fields;

/* Every combatant carries a hand: raised asks for the Spotlight, order is
   the raise sequence the Up Next queue reads. */
export default class ParticipantData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      hand: new SchemaField({
        raised: new BooleanField(),
        order: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 })
      })
    };
  }
}
