import 'package:final_project/core/app_ui.dart';

import '../../core/app_colors.dart';
import '../../models/user_role.dart';
import '../../widgets/brand_header.dart';

class ForgotPasswordScreen extends StatefulWidget {
  final UserRole selectedRole;
  final String initialEmail;

  const ForgotPasswordScreen({
    super.key,
    required this.selectedRole,
    this.initialEmail = '',
  });

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _emailController;
  bool _showRecoveryHelp = false;

  @override
  void initState() {
    super.initState();
    _emailController = TextEditingController(text: widget.initialEmail);
  }

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  void _requestReset() {
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    // The backend does not implement password-reset delivery. Never report a sent email.
    setState(() => _showRecoveryHelp = true);
  }

  @override
  Widget build(BuildContext context) {
    final roleLabel = widget.selectedRole == UserRole.teacher
        ? 'Teacher'
        : 'Parent';

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SingleChildScrollView(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              children: [
                BrandHeader(
                  title: 'ChildGuard',
                  subtitle: '$roleLabel account recovery',
                  height: 210,
                  logoSize: 84,
                  onBack: () => Navigator.pop(context),
                ),
                Transform.translate(
                  offset: const Offset(0, -30),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(28),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.06),
                            blurRadius: 18,
                            offset: const Offset(0, 8),
                          ),
                        ],
                      ),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: const Color(0xFFE0F2FE),
                                borderRadius: BorderRadius.circular(18),
                              ),
                              child: const Icon(
                                Icons.lock_reset_rounded,
                                color: AppColors.primaryBlue,
                                size: 32,
                              ),
                            ),
                            const SizedBox(height: 20),
                            const Text(
                              'Forgot your password?',
                              style: TextStyle(
                                fontSize: 26,
                                fontWeight: FontWeight.w800,
                                color: AppColors.textPrimary,
                                letterSpacing: -0.5,
                              ),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              'Enter the email address for your ${roleLabel.toLowerCase()} account to request password recovery.',
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                height: 1.5,
                              ),
                            ),
                            const SizedBox(height: 24),
                            TextFormField(
                              controller: _emailController,
                              keyboardType: TextInputType.emailAddress,
                              textInputAction: TextInputAction.done,
                              autofillHints: const [AutofillHints.email],
                              onFieldSubmitted: (_) => _requestReset(),
                              onChanged: (_) {
                                if (_showRecoveryHelp) {
                                  setState(() => _showRecoveryHelp = false);
                                }
                              },
                              validator: (value) {
                                final email = value?.trim() ?? '';
                                if (email.isEmpty) {
                                  return context.translate(
                                    'Please enter your email address',
                                  );
                                }
                                if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
                                    .hasMatch(email)) {
                                  return context.translate(
                                    'Enter a valid email address',
                                  );
                                }
                                return null;
                              },
                              decoration: InputDecoration(
                                labelText: context.translate('Email address'),
                                hintText: 'you@example.com',
                                prefixIcon: Icon(Icons.mail_outline_rounded),
                              ),
                            ),
                            const SizedBox(height: 20),
                            SizedBox(
                              width: double.infinity,
                              child: ElevatedButton.icon(
                                onPressed: _requestReset,
                                icon: const Icon(Icons.send_outlined, size: 20),
                                label: const Text('Request reset link'),
                              ),
                            ),
                            if (_showRecoveryHelp) ...[
                              const SizedBox(height: 20),
                              Container(
                                padding: const EdgeInsets.all(16),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFFFF3E0),
                                  borderRadius: BorderRadius.circular(16),
                                ),
                                child: Semantics(
                                  liveRegion: true,
                                  child: const Text(
                                    'Email recovery is currently unavailable. No reset email has been sent. Please contact your school administrator for help accessing your account.',
                                    style: TextStyle(
                                      color: Color(0xFF854D0E),
                                      height: 1.5,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                            const SizedBox(height: 12),
                            Center(
                              child: TextButton.icon(
                                onPressed: () => Navigator.pop(context),
                                icon: const Icon(
                                  Icons.arrow_back_rounded,
                                  size: 18,
                                ),
                                label: Text('Back to $roleLabel login'),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
