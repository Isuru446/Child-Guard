import '../../core/widgets/attendance_confirmation.dart';
import '../../core/backend.dart';
import '../../core/widgets/backend_panels.dart';

import 'package:final_project/core/app_ui.dart';

import '../../core/app_colors.dart';
import '../../core/widgets/app_avatar.dart';
import 'student_profile_screen.dart';

class StudentDirectoryScreen extends StatefulWidget {
  final bool showTeacherHeader;

  const StudentDirectoryScreen({super.key, this.showTeacherHeader = true});

  @override
  State<StudentDirectoryScreen> createState() => _StudentDirectoryScreenState();
}

class _StudentDirectoryScreenState extends State<StudentDirectoryScreen> {
  String _selectedFilter = 'All Students';
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  final List<Map<String, dynamic>> _students = [];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _filteredStudents {
    return _students.where((student) {
      final matchesSearch = student['name'].toString().toLowerCase().contains(
        _searchQuery.toLowerCase(),
      );
      if (_selectedFilter == 'All Students') return matchesSearch;
      final status = const {
        'Present': 'PRESENT',
        'Pending': 'CHECKIN_PENDING',
        'Absent': 'ABSENT',
      }[_selectedFilter];
      return matchesSearch && student['attendanceStatus'] == status;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7F9),
      body: SafeArea(
        child: SingleChildScrollView(
          child: Column(
            children: [
              if (widget.showTeacherHeader) ...[
                _buildTopTeacherHeader(context),
                const SizedBox(height: 16),
              ] else ...[
                _buildAttendanceHeader(context),
                const SizedBox(height: 8),
              ],
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  children: [
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        'Student list',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    _buildSearchBar(),
                    const SizedBox(height: 16),
                    _buildFilterPills(),
                    const SizedBox(height: 36),
                    BackendFeed(
                      key: const ValueKey('teacher-attendance-student-list'),
                      load: () async {
                        final children = await BackendSession.instance.api.all(
                          '/api/v1/mobile/children',
                        );
                        final attendance = await BackendSession.instance.api
                            .all('/api/v1/attendance');
                        return {'children': children, 'attendance': attendance};
                      },
                      builder: (context, value) {
                        final data = value as Map<String, dynamic>;
                        _students.clear();
                        for (final child in data['children'] as List) {
                          final records = (data['attendance'] as List).where(
                            (a) => a['childId'] == child['id'],
                          );
                          final status = records.isEmpty
                              ? 'NO_RECORD'
                              : records.first['status'];
                          _students.add({
                            'id': child['id'],
                            'name': child['name'],
                            'location':
                                '${attendanceLabel(status)}${records.isNotEmpty && (records.first['confirmations'] as List? ?? []).isNotEmpty && records.first['confirmations'][0]['method'] == 'RFID_CARD' ? "\n${attendanceConfirmationText(records.first['confirmations'][0])}" : ""}',
                            'attendanceStatus': status,
                            'status': attendanceLabel(status),
                            'avatar': '',
                            'dotColor': status == 'PRESENT'
                                ? AppColors.greenOnline
                                : AppColors.textSecondary,
                          });
                        }
                        return _buildStudentCardsList();
                      },
                    ),
                    if (!widget.showTeacherHeader) ...[
                      const SizedBox(height: 20),
                      const PendingAttendancePanel(
                        title: "Today's Attendance Actions",
                      ),
                    ],
                    const SizedBox(height: 80),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAttendanceHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 20, 0),
      child: Row(
        children: [
          IconButton(
            tooltip: context.translate('Back'),
            onPressed: () => Navigator.maybePop(context),
            icon: const Icon(Icons.arrow_back_ios_new_rounded),
            color: AppColors.primaryBlue,
          ),
          const SizedBox(width: 4),
          const Expanded(
            child: Text(
              'Attendance',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 21,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.4,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTopTeacherHeader(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: AppColors.primaryBlue,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(36)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 48, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              IconButton(
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                icon: const Icon(
                  Icons.arrow_back_ios,
                  color: Colors.white,
                  size: 20,
                ),
                onPressed: () => Navigator.pop(context),
              ),
              Row(
                children: [
                  const AppAvatar(
                    size: 58,
                    fallbackIcon: Icons.school_rounded,
                    borderColor: Colors.white,
                    borderWidth: 2,
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Hello,',
            style: TextStyle(color: Colors.white70, fontSize: 16),
          ),
          const SizedBox(height: 2),
          Text(
            BackendSession.instance.user?['username'] as String? ?? 'Teacher',
            style: TextStyle(
              color: Colors.white,
              fontSize: 30,
              fontWeight: FontWeight.bold,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(24),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: const [
                Icon(Icons.circle, color: Colors.greenAccent, size: 10),
                SizedBox(width: 8),
                Text(
                  'Assigned center',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                SizedBox(width: 12),
                Text(
                  '•',
                  style: TextStyle(color: Colors.white70, fontSize: 14),
                ),
                SizedBox(width: 12),
                Text(
                  'Center-wide scope',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFEEF4FB),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE1EAF4)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: TextField(
        controller: _searchController,
        onChanged: (val) {
          setState(() {
            _searchQuery = val;
          });
        },
        decoration: InputDecoration(
          hintText: context.translate('Search student by name'),
          hintStyle: const TextStyle(color: Color(0xFF94A3B8), fontSize: 14),
          prefixIcon: const Icon(Icons.search, color: Color(0xFF64748B)),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(
            vertical: 14,
            horizontal: 20,
          ),
        ),
      ),
    );
  }

  Widget _buildFilterPills() {
    return Row(
      children: [
        Expanded(flex: 16, child: _buildFilterItem('All Students')),
        const SizedBox(width: 6),
        Expanded(flex: 11, child: _buildFilterItem('Present')),
        const SizedBox(width: 6),
        Expanded(flex: 12, child: _buildFilterItem('Pending')),
        const SizedBox(width: 6),
        Expanded(flex: 10, child: _buildFilterItem('Absent')),
      ],
    );
  }

  Widget _buildFilterItem(String title) {
    final isSelected = _selectedFilter == title;
    return Semantics(
      button: true,
      selected: isSelected,
      child: GestureDetector(
        key: ValueKey('attendance-filter-$title'),
        onTap: () {
          setState(() {
            _selectedFilter = title;
          });
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? AppColors.primaryBlue : Colors.white,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(
              color: isSelected
                  ? AppColors.primaryBlue
                  : const Color(0xFFE2E8F0),
            ),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: AppColors.primaryBlue.withValues(alpha: 0.25),
                      blurRadius: 8,
                      offset: const Offset(0, 4),
                    ),
                  ]
                : null,
          ),
          child: Text(
            title,
            textAlign: TextAlign.center,
            maxLines: 1,
            softWrap: false,
            style: TextStyle(
              color: isSelected ? Colors.white : const Color(0xFF1E293B),
              fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
              fontSize: 13,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStudentCardsList() {
    final list = _filteredStudents;
    if (list.isEmpty) {
      final message = _selectedFilter == 'Absent'
          ? (_searchQuery.isEmpty
                ? 'No children have been marked absent today.'
                : 'No matching absent children found.')
          : 'No students found';
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 40),
        child: Center(
          child: Text(
            message,
            style: const TextStyle(color: Color(0xFF64748B), fontSize: 14),
          ),
        ),
      );
    }

    return ListView.separated(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: list.length,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final item = list[index];

        // ADDED HERE: Wrap the Container with InkWell
        return InkWell(
          borderRadius: BorderRadius.circular(24),
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (context) => StudentProfileScreen(
                  studentName: item['name'] as String,
                  childId: item['id'] as String,
                  avatarUrl: item['avatar'] as String,
                ),
              ),
            );
          },
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.02),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Row(
              children: [
                AppAvatar(
                  imageUrl: item['avatar'] as String,
                  size: 48,
                  fallbackIcon: Icons.child_care_rounded,
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              item['name'] as String,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF1E293B),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Icon(
                            Icons.circle,
                            color: item['dotColor'] as Color,
                            size: 8,
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        item['location'] as String,
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF64748B),
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(
                  Icons.chevron_right,
                  color: Color(0xFF94A3B8),
                  size: 20,
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
