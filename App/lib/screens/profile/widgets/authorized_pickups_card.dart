import '../../../core/backend.dart';
import '../../pickup/pickup_screen.dart';

import 'package:final_project/core/app_ui.dart';

import '../../../core/app_colors.dart';
import '../../../core/demo_security_store.dart';
import '../generate_otp_screen.dart';
import '../register_pickup_screen.dart';

class AuthorizedPickupsSection extends StatefulWidget {
  const AuthorizedPickupsSection({super.key});

  @override
  State<AuthorizedPickupsSection> createState() =>
      _AuthorizedPickupsSectionState();
}

class _AuthorizedPickupsSectionState extends State<AuthorizedPickupsSection> {
  @override
  Widget build(BuildContext context) {
    if (BackendSession.instance.signedIn) return const PickupScreen();
    final guardians = DemoSecurityStore.guardians;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'AUTHORIZED PICKUPS',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.bold,
            letterSpacing: 0.8,
            color: Color(0xFF64748B),
          ),
        ),
        const SizedBox(height: 10),
        Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.03),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            children: [
              for (var index = 0; index < guardians.length; index++) ...[
                if (index > 0)
                  const Divider(
                    height: 1,
                    indent: 70,
                    endIndent: 20,
                    color: Color(0xFFF1F5F9),
                  ),
                _buildPickupPersonRow(context, guardians[index]),
              ],
            ],
          ),
        ),
        const SizedBox(height: 14),
        _buildAddPickupButton(context),
      ],
    );
  }

  Widget _buildPickupPersonRow(BuildContext context, DemoGuardian guardian) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () {
          // Navigates directly to the Generate OTP Screen
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => GenerateOtpScreen(
                personName: guardian.name,
                relation: guardian.relationship,
                personImage: '',
              ),
            ),
          );
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: const Color(0xFFE7F0FC),
                child: const Icon(
                  Icons.person_rounded,
                  color: AppColors.primaryBlue,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      guardian.name,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1E293B),
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '${guardian.relationship} • Verified pickup',
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xFF64748B),
                      ),
                    ),
                  ],
                ),
              ),
              const Text(
                'Generate OTP',
                style: TextStyle(
                  color: AppColors.primaryBlue,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
              const SizedBox(width: 4),
              const Icon(
                Icons.arrow_forward_ios,
                size: 12,
                color: AppColors.primaryBlue,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAddPickupButton(BuildContext context) {
    return Container(
      width: double.infinity,
      height: 48,
      decoration: BoxDecoration(
        color: const Color(0xFFF0F7FF),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: const Color(0xFF90CAF9),
          style: BorderStyle.solid,
          width: 1.2,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (context) => const RegisterPickupScreen(),
              ),
            );
          },
          child: const Center(
            child: Text(
              '+ Add Pickup Person',
              style: TextStyle(
                color: Color(0xFF0077CC),
                fontWeight: FontWeight.bold,
                fontSize: 14,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
