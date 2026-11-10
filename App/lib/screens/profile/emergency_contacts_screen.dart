import '../../core/backend.dart';
import '../../core/phone_actions.dart';
import 'account_management_screen.dart';

import 'package:final_project/core/app_ui.dart';

import '../../core/app_colors.dart';
import '../../core/widgets/responsive_content.dart';
import '../../models/user_role.dart';

class EmergencyContactsScreen extends StatefulWidget {
  final UserRole userRole;

  const EmergencyContactsScreen({super.key, required this.userRole});

  @override
  State<EmergencyContactsScreen> createState() =>
      _EmergencyContactsScreenState();
}

class _EmergencyContactsScreenState extends State<EmergencyContactsScreen> {
  late final List<_EmergencyContact> _contacts =
      BackendSession.instance.signedIn
      ? <_EmergencyContact>[]
      : widget.userRole == UserRole.teacher
      ? [
          const _EmergencyContact(
            name: 'Greenwood School Office',
            relationship: 'School contact',
            phone: '+1 202 555 0100',
            icon: Icons.school_outlined,
            isPrimary: true,
          ),
        ]
      : [
          const _EmergencyContact(
            name: 'Demo Guardian',
            relationship: 'Primary guardian',
            phone: '+1 202 555 0100',
            icon: Icons.person_outline_rounded,
            isPrimary: true,
          ),
          const _EmergencyContact(
            name: 'Greenwood School Office',
            relationship: 'School contact',
            phone: '+1 202 555 0100',
            icon: Icons.school_outlined,
          ),
        ];

  bool get _isTeacher => widget.userRole == UserRole.teacher;
  Map<String, dynamic>? _serverProfile;
  String? _error;
  bool _busy = false;
  @override
  void initState() {
    super.initState();
    if (BackendSession.instance.signedIn) {
      _load();
    }
  }

  Future<void> _load() async {
    try {
      final result = await BackendSession.instance.api.request(
        '/api/v1/mobile/profile',
      ) as Map;
      if (!mounted) return;
      setState(() {
        _serverProfile = result['profile'] == null
            ? null
            : Map<String, dynamic>.from(result['profile'] as Map);
        _contacts.clear();
        for (final value
            in (_serverProfile?['emergencyContacts'] as List? ?? [])) {
          _contacts.add(
            _EmergencyContact(
              name: value['name'] as String,
              relationship: value['relationship'] as String,
              phone: value['phone'] as String,
              icon: Icons.person_outline_rounded,
            ),
          );
        }
      });
    } catch (error) {
      if (mounted) {
        setState(() => _error = error.toString());
      }
    }
  }

  Future<bool> _persist(List<_EmergencyContact> next) async {
    if (!BackendSession.instance.signedIn) return true;
    if (_busy) return false;
    if (_serverProfile == null) {
      setState(
        () => _error = 'Complete your account profile before saving contacts.',
      );
      return false;
    }
    setState(() => _busy = true);
    try {
      await BackendSession.instance.api.request(
        '/api/v1/mobile/profile',
        method: 'PATCH',
        body: {
          'fullName': _serverProfile!['fullName'],
          'email': _serverProfile!['email'],
          'phone': _serverProfile!['phone'],
          'emergencyContacts': next
              .map(
                (c) => {
                  'name': c.name,
                  'phone': c.phone,
                  'relationship': c.relationship,
                },
              )
              .toList(),
        },
      );
      if (mounted) {
        setState(() => _error = null);
      }
      return true;
    } catch (error) {
      if (mounted) {
        setState(() => _error = error.toString());
      }
      return false;
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _remove(_EmergencyContact contact) async {
    final next = _contacts.where((c) => c != contact).toList();
    if (await _persist(next) && mounted) {
      setState(() {
        _contacts.clear();
        _contacts.addAll(next);
      });
    }
  }

  Future<void> _addContact() async {
    final contact = await showDialog<_EmergencyContact>(
      context: context,
      builder: (_) => const _AddContactDialog(),
    );
    if (contact == null || !mounted) return;
    if (!await _persist([..._contacts, contact]) || !mounted) return;
    setState(() => _contacts.add(contact));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          BackendSession.instance.signedIn
              ? 'Emergency contact saved to ChildGuard.'
              : 'Emergency contact added for this session.',
        ),
      ),
    );
  }

  void _showCallInfo(_EmergencyContact contact) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Call ${contact.name}?'),
        content: Text(
          '${contact.phone}\n\nCalls are not initiated automatically. Use your phone dialer.',
        ),
        actions: [
          TextButton(
            onPressed: () async {
              final opened = await PhoneActions.dial(contact.phone);
              if (dialogContext.mounted) Navigator.pop(dialogContext);
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(
                      opened
                          ? 'Dialer opened. Press Call yourself; call completion is not confirmed.'
                          : 'Phone dialer unavailable. No call was placed.',
                    ),
                  ),
                );
              }
            },
            child: const Text('Open dialer'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Emergency Contacts'),
        leading: IconButton(
          tooltip: context.translate('Back'),
          onPressed: () => Navigator.maybePop(context),
          icon: const Icon(Icons.arrow_back_rounded),
        ),
        actions: [
          IconButton(
            tooltip: context.translate('Add emergency contact'),
            onPressed: _busy ? null : _addContact,
            icon: const Icon(Icons.person_add_alt_1_rounded),
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
          child: ResponsiveContent(
            maxWidth: 640,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_error != null)
                  Text(
                    _error!,
                    style: const TextStyle(color: AppColors.sosRed),
                  ),
                if (BackendSession.instance.signedIn)
                  TextButton(
                    onPressed: () async {
                      await Navigator.push(
                        context,
                        MaterialPageRoute<void>(
                          builder: (_) => const AccountManagementScreen(),
                        ),
                      );
                      if (mounted) {
                        await _load();
                      }
                    },
                    child: const Text('Edit account profile'),
                  ),
                _EmergencyBanner(isTeacher: _isTeacher),
                const SizedBox(height: 22),
                Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Trusted contacts',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    TextButton.icon(
                      onPressed: _busy ? null : _addContact,
                      icon: const Icon(Icons.add_rounded, size: 18),
                      label: const Text('Add contact'),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                for (final contact in _contacts) ...[
                  _ContactCard(
                    contact: contact,
                    onCall: () => _showCallInfo(contact),
                    onRemove: contact.isPrimary ? null : () => _remove(contact),
                  ),
                  const SizedBox(height: 10),
                ],
                if (_contacts.isEmpty)
                  const _EmptyContactsCard()
                else
                  _SafetyNote(isTeacher: _isTeacher),
                const SizedBox(height: 14),
                Center(
                  child: Text(
                    BackendSession.instance.signedIn
                        ? 'Contact details are saved to your account after the server confirms.'
                        : 'Contact details are saved for this demo session only.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 11,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EmergencyContact {
  final String name;
  final String relationship;
  final String phone;
  final IconData icon;
  final bool isPrimary;

  const _EmergencyContact({
    required this.name,
    required this.relationship,
    required this.phone,
    required this.icon,
    this.isPrimary = false,
  });
}

class _EmergencyBanner extends StatelessWidget {
  final bool isTeacher;

  const _EmergencyBanner({required this.isTeacher});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF0F0),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.crisis_alert_rounded,
              color: AppColors.sosRed,
              size: 25,
            ),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isTeacher
                      ? 'School emergency contacts'
                      : 'Here when it matters',
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  isTeacher
                      ? 'Keep key school contacts easy to reach.'
                      : 'Keep your trusted people close at hand.',
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ContactCard extends StatelessWidget {
  final _EmergencyContact contact;
  final VoidCallback onCall;
  final VoidCallback? onRemove;

  const _ContactCard({
    required this.contact,
    required this.onCall,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: contact.isPrimary
                    ? const Color(0xFFE7F1FF)
                    : const Color(0xFFE7F8EF),
                child: Icon(
                  contact.icon,
                  color: contact.isPrimary
                      ? AppColors.primaryBlue
                      : AppColors.greenOnline,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      contact.name,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      contact.relationship,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              if (contact.isPrimary)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.greenOnlineBg,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text(
                    'PRIMARY',
                    style: TextStyle(
                      color: AppColors.greenOnline,
                      fontSize: 9,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.4,
                    ),
                  ),
                )
              else if (onRemove != null)
                IconButton(
                  tooltip: context.translate('Remove ${contact.name}'),
                  onPressed: onRemove,
                  icon: const Icon(
                    Icons.delete_outline_rounded,
                    color: AppColors.textSecondary,
                    size: 20,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              const Icon(
                Icons.phone_outlined,
                color: AppColors.textSecondary,
                size: 17,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  contact.phone,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              SizedBox(
                height: 36,
                child: FilledButton.icon(
                  onPressed: onCall,
                  icon: const Icon(Icons.call_rounded, size: 16),
                  label: const Text('Call'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.greenOnline,
                    padding: const EdgeInsets.symmetric(horizontal: 13),
                    textStyle: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SafetyNote extends StatelessWidget {
  final bool isTeacher;

  const _SafetyNote({required this.isTeacher});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF3FF),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.info_outline_rounded,
            color: AppColors.primaryBlue,
            size: 19,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              isTeacher
                  ? 'Only share student emergency details with authorized school staff.'
                  : 'Make sure your trusted contacts know they may be contacted about your child.',
              style: const TextStyle(
                color: AppColors.primaryBlue,
                fontSize: 12,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyContactsCard extends StatelessWidget {
  const _EmptyContactsCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: const Column(
        children: [
          Icon(
            Icons.contact_phone_outlined,
            color: AppColors.textSecondary,
            size: 34,
          ),
          SizedBox(height: 9),
          Text(
            'No additional contacts yet',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w700,
            ),
          ),
          SizedBox(height: 4),
          Text(
            'Add a trusted person to keep their details handy.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _AddContactDialog extends StatefulWidget {
  const _AddContactDialog();

  @override
  State<_AddContactDialog> createState() => _AddContactDialogState();
}

class _AddContactDialogState extends State<_AddContactDialog> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _relationshipController = TextEditingController();
  final _phoneController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    _relationshipController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  String? _requiredField(String? value, String label) {
    if (value == null || value.trim().isEmpty) {
      return context.translate('Enter $label');
    }
    return null;
  }

  void _save() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.pop(
      context,
      _EmergencyContact(
        name: _nameController.text.trim(),
        relationship: _relationshipController.text.trim(),
        phone: _phoneController.text.trim(),
        icon: Icons.person_add_alt_1_rounded,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add emergency contact'),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: _nameController,
                textCapitalization: TextCapitalization.words,
                decoration: InputDecoration(
                  labelText: context.translate('Full name'),
                  prefixIcon: Icon(Icons.person_outline_rounded),
                ),
                validator: (value) => _requiredField(value, 'a name'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _relationshipController,
                textCapitalization: TextCapitalization.words,
                decoration: InputDecoration(
                  labelText: context.translate('Relationship / role'),
                  prefixIcon: Icon(Icons.people_outline_rounded),
                ),
                validator: (value) => _requiredField(value, 'a relationship'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                decoration: InputDecoration(
                  labelText: context.translate('Phone number'),
                  prefixIcon: Icon(Icons.phone_outlined),
                ),
                validator: (value) => _requiredField(value, 'a phone number'),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _save, child: const Text('Save contact')),
      ],
    );
  }
}
