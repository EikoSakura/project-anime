const { ArrayField, BooleanField, NumberField, SchemaField, StringField } = foundry.data.fields;

/* Ranks are indices 0..5 into the Ladder, E..S. */
export function rankField(initial = 0) {
  return new NumberField({ required: true, nullable: false, integer: true, min: 0, max: 5, initial });
}

export function textField() {
  return new StringField({ required: true, initial: "" });
}

export function rulingsField() {
  return new ArrayField(textField());
}

export function pointsField() {
  return new SchemaField({
    value: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 6 }),
    max: new NumberField({ required: true, nullable: false, integer: true, min: 1, initial: 6 })
  });
}

export function attributesField() {
  return new SchemaField({
    might: rankField(),
    agility: rankField(),
    mind: rankField(),
    spirit: rankField(),
    charm: rankField()
  });
}

export function luckField() {
  return new ArrayField(
    new SchemaField({
      die: new NumberField({ required: true, nullable: false, integer: true, initial: 6, choices: [6, 8, 10, 12] }),
      value: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      spent: new BooleanField()
    }),
    { required: true, initial: () => Array.from({ length: 3 }, () => ({ die: 6, value: 0, spent: false })) }
  );
}
