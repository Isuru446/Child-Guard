import '../../core/registration_validation.dart';

import 'package:flutter/material.dart';

class RegistrationChildDraft {
  bool existing = false;
  bool wearable = false;
  final reference = TextEditingController();
  final name = TextEditingController();
  final birthDate = TextEditingController();
  final relationship = TextEditingController();
  final device = TextEditingController();
  final claim = TextEditingController();
  Map<String, dynamic> toJson() => {
    if (existing)
      'existingChildId': reference.text.trim()
    else ...{
      'fullName': name.text.trim(),
      'dateOfBirth': birthDate.text.trim(),
    },
    'relationship': relationship.text.trim(),
    if (wearable)
      'wearable': {
        'hardwareId': device.text.trim(),
        'claimCode': claim.text.trim(),
      },
  };
  void dispose() {
    for (final controller in [
      reference,
      name,
      birthDate,
      relationship,
      device,
      claim,
    ]) {
      controller.dispose();
    }
  }
}

class RegistrationChildForm extends StatelessWidget {
  final RegistrationChildDraft draft;
  final int number;
  final VoidCallback onChanged;
  final VoidCallback? onRemove;
  final Map<String, String>? errors;
  final String errorPrefix;
  const RegistrationChildForm({
    super.key,
    required this.draft,
    required this.number,
    required this.onChanged,
    this.onRemove,
    this.errors,
    this.errorPrefix = '',
  });
  String fieldKey(TextEditingController controller) {
    if (controller == draft.reference) return 'existingChildId';
    if (controller == draft.name) return 'fullName';
    if (controller == draft.birthDate) return 'dateOfBirth';
    if (controller == draft.relationship) return 'relationship';
    if (controller == draft.device) return 'wearable.hardwareId';
    return 'wearable.claimCode';
  }

  Widget field(String label, TextEditingController controller) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: TextFormField(
      controller: controller,
      decoration: InputDecoration(
        labelText: label,
        filled: true,
        fillColor: const Color(0xFFF8FAFC),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide.none,
        ),
      ),
      autovalidateMode: AutovalidateMode.onUserInteraction,
      onChanged: (_) {
        errors?.remove('$errorPrefix${fieldKey(controller)}');
      },
      validator: (value) =>
          errors?['$errorPrefix${fieldKey(controller)}'] ??
          RegistrationValidation.field(
            fieldKey(controller).split('.').last,
            value,
          ),
    ),
  );
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        'Child $number',
        style: const TextStyle(fontWeight: FontWeight.bold),
      ),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Child already registered at this center'),
        value: draft.existing,
        onChanged: (value) {
          draft.existing = value;
          onChanged();
        },
      ),
      if (draft.existing)
        field('Existing child reference (center-provided)', draft.reference)
      else ...[
        field('Child full name', draft.name),
        field('Date of birth (YYYY-MM-DD)', draft.birthDate),
      ],
      field('Your relationship to this child', draft.relationship),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Add wearable request (optional)'),
        value: draft.wearable,
        onChanged: (value) {
          draft.wearable = value;
          onChanged();
        },
      ),
      if (draft.wearable) ...[
        field('Wearable device identifier', draft.device),
        field('One-time claim code from center', draft.claim),
        const Text(
          'This is a request only. Your center verifies the child relationship and wearable separately.',
        ),
      ],
      if (onRemove != null)
        TextButton(
          onPressed: onRemove,
          child: const Text('Remove child entry'),
        ),
    ],
  );
}
