import 'dart:typed_data';
import 'dart:convert';

import 'package:image_picker/image_picker.dart';

import '../../core/registration.dart';
import '../../core/registration_validation.dart';
import '../../core/backend.dart';
import 'registration_child_form.dart';

import 'package:final_project/core/app_ui.dart';

import '../../core/app_colors.dart';
import '../../models/user_role.dart';
import '../../widgets/brand_logo.dart';

class RegisterScreen extends StatefulWidget {
  final UserRole selectedRole;
  final RegistrationClient? registrationClient;

  const RegisterScreen({
    super.key,
    required this.selectedRole,
    this.registrationClient,
  });

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _fullNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  final _usernameController = TextEditingController();
  String? _centerId;
  List<Map<String, String>> _centers = [];
  bool _centersLoading = true;
  String? _centersError;
  final _children = <RegistrationChildDraft>[RegistrationChildDraft()];
  late final RegistrationClient _registration =
      widget.registrationClient ??
      RegistrationClient(
        role: widget.selectedRole == UserRole.teacher ? 'TEACHER' : 'PARENT',
      );
  bool _restoring = true;
  bool _terms = false;
  bool _busy = false;
  bool _resubmit = false;
  Map<String, dynamic>? _status;
  String? _error;
  final Map<String, String> _fieldErrors = {};
  Uint8List? _photo;
  String _photoMime = 'image/jpeg';

  bool _isPasswordVisible = false;
  bool _isConfirmPasswordVisible = false;

  @override
  void initState() {
    super.initState();
    _loadCenters();
    _restoreRegistration();
  }

  Future<void> _restoreRegistration() async {
    try {
      final row = await _registration.status();
      if (mounted) {
        setState(() {
          _status = row;
        });
      }
    } on ApiFailure catch (error) {
      if (mounted &&
          !error.message.startsWith('No saved registration receipt')) {
        setState(() {
          _error =
              'Saved registration status could not be loaded. ${error.message}';
        });
      }
    } catch (_) {
      // A fresh install/test may not provide secure storage yet; never invent a session.
    } finally {
      if (mounted) {
        setState(() {
          _restoring = false;
        });
      }
    }
  }

  Future<void> _loadCenters() async {
    setState(() {
      _centersLoading = true;
      _centersError = null;
    });
    try {
      final rows = await _registration.centers();
      if (!mounted) return;
      setState(() {
        _centers = rows;
        if (!rows.any((row) => row['id'] == _centerId)) {
          _centerId = null;
        }
        _fieldErrors.remove('centerId');
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _centersError = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _centersLoading = false;
        });
      }
    }
  }

  Widget _centerSelection() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      DropdownButtonFormField<String>(
        key: ValueKey(_centerId),
        initialValue: _centers.any((row) => row['id'] == _centerId)
            ? _centerId
            : null,
        isExpanded: true,
        decoration: InputDecoration(
          hintText: 'Select Your Center',
          prefixIcon: const Icon(
            Icons.school_outlined,
            color: Color(0xFF94A3B8),
          ),
          filled: true,
          fillColor: const Color(0xFFF8FAFC),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(18),
            borderSide: BorderSide.none,
          ),
        ),
        items: _centers
            .map(
              (row) => DropdownMenuItem(
                value: row['id'],
                child: Text(row['name']!, overflow: TextOverflow.ellipsis),
              ),
            )
            .toList(),
        onChanged: _centersLoading || _centersError != null || _busy
            ? null
            : (value) => setState(() {
                _centerId = value;
                _fieldErrors.remove('centerId');
              }),
        validator: (value) => _centersLoading
            ? 'Wait for centers to load'
            : _centersError != null
            ? 'Reload the center list before submitting'
            : _fieldErrors['centerId'] ??
                  (value == null || !_centers.any((row) => row['id'] == value)
                      ? 'Select Your Center'
                      : null),
      ),
      if (_centersLoading) const LinearProgressIndicator(),
      if (_centersError != null)
        Text(
          'Unable to load centers. $_centersError',
          style: const TextStyle(color: AppColors.sosRed),
        ),
      if (!_centersLoading && _centersError == null && _centers.isEmpty)
        const Text(
          'No centers are currently accepting public registrations. Contact your center.',
        ),
      TextButton(
        onPressed: _centersLoading || _busy ? null : _loadCenters,
        child: Text(_centersError != null ? 'Retry' : 'Refresh centers'),
      ),
    ],
  );

  @override
  void dispose() {
    _fullNameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _usernameController.dispose();

    for (final child in _children) {
      child.dispose();
    }
    super.dispose();
  }

  Future<void> _pickPhoto(ImageSource source) async {
    try {
      final selected = await ImagePicker().pickImage(
        source: source,
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 85,
      );
      if (selected == null) return;
      final bytes = await selected.readAsBytes();
      if (bytes.length > 2 * 1024 * 1024 || bytes.length < 24) {
        throw Exception('Choose a valid photo up to 2 MB.');
      }
      if (!mounted) return;
      setState(() {
        _photo = bytes;
        _photoMime = bytes[0] == 137
            ? 'image/png'
            : bytes[0] == 255
            ? 'image/jpeg'
            : 'image/webp';
      });
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Photo selection failed. Choose a JPEG, PNG or WebP up to 2 MB.',
        );
      }
    }
  }

  Future<void> _checkStatus() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final row = await _registration.status();
      if (mounted) {
        setState(() => _status = row);
      }
    } catch (error) {
      if (mounted) {
        setState(() => _error = error.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _handleRegister() async {
    if (_busy || _restoring) return;
    _fieldErrors.clear();
    if (!_formKey.currentState!.validate()) return;
    if (!_terms) {
      setState(
        () => _error = 'Accept the privacy policy and terms to continue.',
      );
      return;
    }
    if (_passwordController.text != _confirmPasswordController.text) {
      setState(() => _error = 'Passwords do not match');
      return;
    }
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final row = await _registration.submit({
        'fullName': _fullNameController.text.trim(),
        'username': _usernameController.text.trim(),
        'email': _emailController.text.trim(),
        'phone': _phoneController.text.trim(),
        'password': _passwordController.text,
        'role': widget.selectedRole == UserRole.teacher ? 'TEACHER' : 'PARENT',
        'centerId': _centerId,
        'acceptTerms': _terms,
        'children': widget.selectedRole == UserRole.teacher
            ? <Map<String, dynamic>>[]
            : _children.map((child) => child.toJson()).toList(),
      }, resubmit: _resubmit);
      if (!mounted) return;
      setState(() {
        _status = row;
        _resubmit = false;
      });
      if (_photo != null) {
        await _registration.upload(_photo!, _photoMime);
      }
    } catch (error) {
      if (mounted) {
        if (error is ApiFailure && error.code == 'RECEIPT_REUSED') {
          try {
            final row = await _registration.status();
            if (mounted) {
              setState(() {
                _status = row;
                _error = row['status'] == 'PENDING'
                    ? 'An application is already pending. Review its status below; do not submit another application.'
                    : row['status'] == 'REJECTED'
                    ? 'Use Correct and resubmit to update your rejected application.'
                    : 'This application is approved. Return to login or contact your administrator.';
              });
            }
          } catch (statusError) {
            if (mounted) {
              setState(() {
                _error =
                    'Check saved registration status before retrying. $statusError';
              });
            }
          }
        } else {
          setState(() {
            _error = error.toString();
            if (error is ApiFailure) _fieldErrors.addAll(error.fields);
          });
        }
        _formKey.currentState?.validate();
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Widget _registrationStatus() {
    final status = _status!['status'];
    final message = status == 'APPROVED'
        ? 'Your registration has been approved. You can now sign in.'
        : status == 'REJECTED'
        ? 'Your registration was not approved.'
        : 'Your registration has been submitted and is awaiting administrator approval.';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(message),
        if (_status!['username'] != null)
          Text(
            'Application: ${_status!['username']} (${_status!['role'] ?? 'selected role'})',
          ),
        if (_status!['reason'] != null) Text(_status!['reason'] as String),
        for (final child in (_status!['children'] as List? ?? []))
          Text(
            '${child['fullName'] ?? child['existingChildId']}: ${child['status']} / Wearable: ${child['wearable']?['status'] ?? 'Not requested'} ${child['wearable']?['reason'] ?? ''}',
          ),
        if (_error != null)
          Text(_error!, style: const TextStyle(color: AppColors.sosRed)),
        TextButton(
          onPressed: _busy ? null : _checkStatus,
          child: const Text('Refresh registration status'),
        ),
        if (status != 'APPROVED')
          TextButton(
            onPressed: _busy ? null : () => _pickPhoto(ImageSource.gallery),
            child: const Text('Choose or replace registration photo'),
          ),
        if (_photo != null && status != 'APPROVED')
          TextButton(
            onPressed: _busy
                ? null
                : () async {
                    try {
                      await _registration.upload(_photo!, _photoMime);
                      if (mounted) {
                        setState(() => _error = null);
                      }
                    } catch (error) {
                      if (mounted) {
                        setState(() => _error = error.toString());
                      }
                    }
                  },
            child: const Text('Retry profile photo upload'),
          ),
        if (status == 'REJECTED')
          TextButton(
            onPressed: () => setState(() {
              _fullNameController.text = _status!['fullName'] as String;
              _usernameController.text = _status!['username'] as String;
              _emailController.text = _status!['email'] as String;
              _phoneController.text = _status!['phone'] as String;
              _centerId = _status!['centerId'] as String?;
              for (final child in _children) {
                child.dispose();
              }
              _children.clear();
              for (final raw in (_status!['children'] as List? ?? [])) {
                final draft = RegistrationChildDraft();
                draft.existing = raw['existingChildId'] != null;
                draft.reference.text = raw['existingChildId'] as String? ?? '';
                draft.name.text = raw['fullName'] as String? ?? '';
                draft.birthDate.text = (raw['dateOfBirth'] as String? ?? '')
                    .split('T')
                    .first;
                draft.relationship.text = raw['relationship'] as String? ?? '';
                draft.wearable = raw['wearable'] != null;
                draft.device.text =
                    raw['wearable']?['hardwareId'] as String? ?? '';
                _children.add(draft);
              }
              if (_children.isEmpty) _children.add(RegistrationChildDraft());
              _status = null;
              _error = 'Review your restored details and re-enter your password and any one-time wearable claim code.';
              _resubmit = true;
            }),
            child: const Text('Correct and resubmit'),
          ),
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Return to login'),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final isTeacher = widget.selectedRole == UserRole.teacher;
    final roleLabel = isTeacher ? 'Teacher' : 'Parent';

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SingleChildScrollView(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              children: [
                // Top Blue Header
                Container(
                  width: double.infinity,
                  height: 220,
                  decoration: const BoxDecoration(
                    color: AppColors.primaryBlue,
                    borderRadius: BorderRadius.vertical(
                      bottom: Radius.circular(36),
                    ),
                  ),
                  child: Stack(
                    children: [
                      Positioned(
                        top: 50,
                        left: 16,
                        child: IconButton(
                          icon: const Icon(
                            Icons.arrow_back_ios,
                            color: Colors.white,
                            size: 20,
                          ),
                          onPressed: () => Navigator.pop(context),
                        ),
                      ),
                      Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const SizedBox(height: 20),
                            const BrandLogo(size: 74),
                            const SizedBox(height: 8),
                            const Text(
                              'Child Guard',
                              style: TextStyle(
                                fontSize: 28,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),

                // Card
                Transform.translate(
                  offset: const Offset(0, -30),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(28),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.06),
                            blurRadius: 18,
                            offset: const Offset(0, 8),
                          ),
                        ],
                      ),
                      child: Material(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(28),
                        clipBehavior: Clip.antiAlias,
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Form(
                            key: _formKey,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (_status != null)
                                  _registrationStatus()
                                else ...[
                                  Center(
                                    child: Text(
                                      'Create $roleLabel Account',
                                      style: const TextStyle(
                                        fontSize: 22,
                                        fontWeight: FontWeight.bold,
                                        color: Color(0xFF1E293B),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 20),

                                  _buildFieldLabel('Full Name'),
                                  _buildInputField(
                                    context: context,
                                    controller: _fullNameController,
                                    hintText: isTeacher
                                        ? 'Ms. Thompson'
                                        : 'Emma Johnson',
                                    icon: Icons.person_outline,
                                  ),
                                  const SizedBox(height: 14),

                                  _buildFieldLabel('Username'),
                                  _buildInputField(
                                    context: context,
                                    controller: _usernameController,
                                    hintText: 'Username',
                                    icon: Icons.person_outline,
                                  ),
                                  const SizedBox(height: 14),
                                  _buildFieldLabel('Select Your Center'),
                                  _centerSelection(),
                                  const SizedBox(height: 14),
                                  _buildFieldLabel('Email Address'),
                                  _buildInputField(
                                    context: context,
                                    controller: _emailController,
                                    hintText: isTeacher
                                        ? 'teacher@example.invalid'
                                        : 'parent@example.invalid',
                                    icon: Icons.email_outlined,
                                    keyboardType: TextInputType.emailAddress,
                                  ),
                                  const SizedBox(height: 14),

                                  _buildFieldLabel('Phone Number'),
                                  _buildInputField(
                                    context: context,
                                    controller: _phoneController,
                                    hintText: '+1 234 567 8900',
                                    icon: Icons.phone_outlined,
                                    keyboardType: TextInputType.phone,
                                  ),
                                  const SizedBox(height: 14),

                                  if (!isTeacher) ...[
                                    for (
                                      var index = 0;
                                      index < _children.length;
                                      index++
                                    )
                                      RegistrationChildForm(
                                        draft: _children[index],
                                        errors: _fieldErrors,
                                        errorPrefix: 'children.$index.',
                                        number: index + 1,
                                        onChanged: () => setState(() {}),
                                        onRemove: _children.length > 1
                                            ? () => setState(() {
                                                _children
                                                    .removeAt(index)
                                                    .dispose();
                                              })
                                            : null,
                                      ),
                                    TextButton(
                                      onPressed: () => setState(
                                        () => _children.add(
                                          RegistrationChildDraft(),
                                        ),
                                      ),
                                      child: const Text('Add another child'),
                                    ),
                                  ],
                                  if (_photo != null)
                                    Image.memory(
                                      _photo!,
                                      height: 100,
                                      width: 100,
                                      fit: BoxFit.cover,
                                    ),
                                  Wrap(
                                    children: [
                                      TextButton(
                                        onPressed: () =>
                                            _pickPhoto(ImageSource.gallery),
                                        child: const Text(
                                          'Choose profile photo',
                                        ),
                                      ),
                                      TextButton(
                                        onPressed: () =>
                                            _pickPhoto(ImageSource.camera),
                                        child: const Text('Use camera'),
                                      ),
                                      if (_photo != null)
                                        TextButton(
                                          onPressed: () =>
                                              setState(() => _photo = null),
                                          child: const Text('Remove photo'),
                                        ),
                                    ],
                                  ),
                                  _buildFieldLabel('Password'),
                                  _buildPasswordField(
                                    context: context,
                                    controller: _passwordController,
                                    isVisible: _isPasswordVisible,
                                    onToggle: () => setState(
                                      () => _isPasswordVisible =
                                          !_isPasswordVisible,
                                    ),
                                  ),
                                  const SizedBox(height: 14),

                                  _buildFieldLabel('Confirm Password'),
                                  _buildPasswordField(
                                    context: context,
                                    controller: _confirmPasswordController,
                                    isVisible: _isConfirmPasswordVisible,
                                    onToggle: () => setState(
                                      () => _isConfirmPasswordVisible =
                                          !_isConfirmPasswordVisible,
                                    ),
                                  ),
                                  const SizedBox(height: 24),

                                  TextButton(
                                    onPressed: () => showDialog<void>(
                                      context: context,
                                      builder: (context) => AlertDialog(
                                        title: const Text(
                                          'Registration privacy and terms',
                                        ),
                                        content: const SingleChildScrollView(
                                          child: Text(
                                            'You are submitting your identity, contact information, optional profile photo and child/Guardian/wearable requests to your selected center for review. Submission grants no account access. Only authorized center administrators may review your application. Child and device relationships require independent approval. Do not upload identity documents or another person?s photo without permission. Contact your center for its retention, correction and deletion policy. No SMS, email or emergency message delivery is promised by registration.',
                                          ),
                                        ),
                                        actions: [
                                          TextButton(
                                            onPressed: () =>
                                                Navigator.pop(context),
                                            child: const Text('Close'),
                                          ),
                                        ],
                                      ),
                                    ),
                                    child: const Text(
                                      'Read registration privacy and terms',
                                    ),
                                  ),
                                  CheckboxListTile(
                                    value: _terms,
                                    onChanged: (value) =>
                                        setState(() => _terms = value ?? false),
                                    title: const Text(
                                      'I accept the privacy policy and terms',
                                    ),
                                    contentPadding: EdgeInsets.zero,
                                  ),
                                  const Text(
                                    'Your center reviews identity, child relationships and optional wearable claims separately. No access is granted before approval. Contact your center for its privacy and retention policy before submitting.',
                                  ),
                                  if (_error != null)
                                    Text(
                                      _error!,
                                      style: const TextStyle(
                                        color: AppColors.sosRed,
                                      ),
                                    ),
                                  if (_busy) const LinearProgressIndicator(),
                                  SizedBox(
                                    width: double.infinity,
                                    height: 52,
                                    child: ElevatedButton(
                                      onPressed: _busy || _restoring
                                          ? null
                                          : _handleRegister,
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: const Color(
                                          0xFF0077B6,
                                        ),
                                        elevation: 0,
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(
                                            26,
                                          ),
                                        ),
                                      ),
                                      child: const Text(
                                        'Sign Up',
                                        style: TextStyle(
                                          fontSize: 16,
                                          fontWeight: FontWeight.bold,
                                          color: Colors.white,
                                        ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 16),

                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      const Text(
                                        'Already have an account? ',
                                        style: TextStyle(
                                          fontSize: 13,
                                          color: Color(0xFF64748B),
                                        ),
                                      ),
                                      GestureDetector(
                                        onTap: () => Navigator.pop(context),
                                        child: const Text(
                                          'Login',
                                          style: TextStyle(
                                            fontSize: 13,
                                            fontWeight: FontWeight.bold,
                                            color: Color(0xFF0077B6),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  TextButton(
                                    onPressed: _busy ? null : _checkStatus,
                                    child: const Text(
                                      'Check saved registration status',
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _fieldFor(TextEditingController controller) {
    if (controller == _fullNameController) return 'fullName';
    if (controller == _usernameController) return 'username';
    if (controller == _emailController) return 'email';
    if (controller == _phoneController) return 'phone';
    return 'centerId';
  }

  Widget _buildFieldLabel(String label) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        label,
        style: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: Color(0xFF64748B),
        ),
      ),
    );
  }

  Widget _buildInputField({
    required BuildContext context,
    required TextEditingController controller,
    required String hintText,
    required IconData icon,
    TextInputType keyboardType = TextInputType.text,
  }) {
    return TextFormField(
      controller: controller,
      readOnly:
          _resubmit &&
          (controller == _usernameController || controller == _emailController),
      keyboardType: keyboardType,
      autovalidateMode: AutovalidateMode.onUserInteraction,
      onChanged: (_) {
        _fieldErrors.remove(_fieldFor(controller));
      },
      validator: (val) =>
          _fieldErrors[_fieldFor(controller)] ??
          RegistrationValidation.field(_fieldFor(controller), val),
      decoration: InputDecoration(
        prefixIcon: Icon(icon, color: const Color(0xFF94A3B8)),
        hintText: context.translate(hintText),
        hintStyle: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
        filled: true,
        fillColor: const Color(0xFFF8FAFC),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }

  Widget _buildPasswordField({
    required BuildContext context,
    required TextEditingController controller,
    required bool isVisible,
    required VoidCallback onToggle,
  }) {
    return TextFormField(
      controller: controller,
      obscureText: !isVisible,
      validator: (val) =>
          _fieldErrors['password'] ??
          (val == null || val.length < 12 || utf8.encode(val).length > 72
              ? context.translate(
                  'Use 12+ characters and at most 72 UTF-8 bytes',
                )
              : controller == _confirmPasswordController &&
                    val != _passwordController.text
              ? 'Passwords do not match'
              : null),
      autovalidateMode: AutovalidateMode.onUserInteraction,
      onChanged: (_) {
        _fieldErrors.remove('password');
      },
      decoration: InputDecoration(
        prefixIcon: const Icon(Icons.lock_outline, color: Color(0xFF94A3B8)),
        suffixIcon: IconButton(
          icon: Icon(
            isVisible ? Icons.visibility : Icons.visibility_off_outlined,
            color: const Color(0xFF94A3B8),
          ),
          onPressed: onToggle,
        ),
        hintText: '••••••••••••',
        filled: true,
        fillColor: const Color(0xFFF8FAFC),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }
}
