import SwiftData
import SwiftUI

/// Create and manage buddy groups. Membership is a local roster in v1:
/// you add your buddies' names/handicaps, and the share-link flow (CKShare
/// on each round) is what actually connects phones. The join code printed
/// here is the group's future cross-device identity — flagged as an open
/// item in the README ("group directory service").
struct GroupsView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @Query(sort: \BuddyGroup.createdAt) private var groups: [BuddyGroup]
    @Query(sort: \PlayerProfile.createdAt) private var profiles: [PlayerProfile]

    @State private var newGroupName = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        TextField("Group name (e.g. Saturday Regulars)", text: $newGroupName)
                        Button("Create") {
                            createGroup()
                        }
                        .disabled(newGroupName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                } header: {
                    Text("New group")
                }

                ForEach(groups) { group in
                    Section {
                        ForEach(group.members) { member in
                            HStack {
                                PlayerAvatar(emoji: member.emoji, size: 32)
                                Text(member.name)
                                Spacer()
                                if let handicap = member.handicapIndex {
                                    Text(String(format: "%.1f", handicap))
                                        .foregroundStyle(Theme.Colors.textSecondary)
                                }
                            }
                        }
                        .onDelete { offsets in
                            for index in offsets {
                                group.members.remove(at: index)
                            }
                        }
                        NavigationLink("Add buddy") {
                            AddBuddyView(group: group)
                        }
                        ShareLink(item: "Join my golf group “\(group.name)” on Birdie — code \(group.joinCode)") {
                            Label("Share join code \(group.joinCode)", systemImage: "square.and.arrow.up")
                        }
                    } header: {
                        Text(group.name)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.Colors.background)
            .navigationTitle("Groups")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func createGroup() {
        let name = newGroupName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        let group = BuddyGroup(name: name)
        // The local user is always a member of their own groups.
        if let me = profiles.first(where: { $0.isMe }) {
            group.members.append(me)
        }
        context.insert(group)
        newGroupName = ""
    }
}

/// Add a buddy profile (name, avatar, handicap) to a group. Profiles are
/// reusable across groups and rounds — this is your local address book.
struct AddBuddyView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    let group: BuddyGroup

    @Query(sort: \PlayerProfile.createdAt) private var profiles: [PlayerProfile]

    @State private var name = ""
    @State private var emoji = "🏌️"
    @State private var handicapText = ""

    private static let emojiChoices = ["🏌️", "🏌️‍♀️", "⛳️", "🦅", "🐺", "🍺", "🎯", "🔥", "🦈", "🃏"]

    private var existingCandidates: [PlayerProfile] {
        profiles.filter { profile in !group.members.contains { $0.id == profile.id } }
    }

    var body: some View {
        List {
            if !existingCandidates.isEmpty {
                Section("Known buddies") {
                    ForEach(existingCandidates) { profile in
                        Button {
                            group.members.append(profile)
                            dismiss()
                        } label: {
                            HStack {
                                PlayerAvatar(emoji: profile.emoji, size: 32)
                                Text(profile.name)
                                    .foregroundStyle(Theme.Colors.textPrimary)
                            }
                        }
                    }
                }
            }

            Section("New buddy") {
                TextField("Name", text: $name)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Spacing.s) {
                        ForEach(Self.emojiChoices, id: \.self) { choice in
                            Button {
                                emoji = choice
                            } label: {
                                PlayerAvatar(emoji: choice, size: 40, highlighted: emoji == choice)
                            }
                        }
                    }
                }
                TextField("Handicap index (optional)", text: $handicapText)
                    .keyboardType(.decimalPad)
                Button("Add to \(group.name)") {
                    let profile = PlayerProfile(
                        name: name.trimmingCharacters(in: .whitespaces),
                        emoji: emoji,
                        handicapIndex: Double(handicapText.replacingOccurrences(of: ",", with: "."))
                    )
                    context.insert(profile)
                    group.members.append(profile)
                    dismiss()
                }
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.Colors.background)
        .navigationTitle("Add buddy")
    }
}
