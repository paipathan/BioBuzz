package org.firstinspires.ftc.teamcode;

import androidx.annotation.NonNull;

import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.commands.Commands;
import com.pedropathing.ivy.groups.Groups;
import com.pedropathing.math.Pose;
import com.bylazar.telemetry.PanelsTelemetry;
import com.qualcomm.robotcore.hardware.Gamepad;

import org.firstinspires.ftc.teamcode.subsystems.Drivetrain;
import org.firstinspires.ftc.teamcode.subsystems.FlowerBar;
import org.firstinspires.ftc.teamcode.subsystems.Intake;
import org.firstinspires.ftc.teamcode.subsystems.Shooter;
import org.firstinspires.ftc.teamcode.subsystems.Transfer;
import org.firstinspires.ftc.teamcode.subsystems.Turret;
import org.firstinspires.ftc.teamcode.util.Alliance;
import org.firstinspires.ftc.teamcode.util.Constants;
import org.firstinspires.ftc.teamcode.util.ShotCalculator;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;

import dev.nextftc.robot.Mechanism;
import dev.nextftc.robot.NextRobot;
import dev.nextftc.robot.Telemetry;
import dev.nextftc.robot.triggers.CommandGamepad;
import dev.nextftc.robot.triggers.Trigger;

public class Robot implements NextRobot {
    public enum State {
        IDLE,
        INTAKE,
        SHOOT,
        UNJAM
    }

    public final Intake intake = new Intake();
    public final Turret turret = new Turret();
    public final Shooter shooter = new Shooter();
    public final Transfer transfer = new Transfer();
    public final Drivetrain drivetrain = new Drivetrain();
    public final FlowerBar flowerBar = new FlowerBar();

    private State state = State.IDLE;
    private Alliance alliance = Alliance.RED;

    public void initialize(Pose startPose, Alliance alliance) {
        this.alliance = alliance;
        Telemetry.addBackend(PanelsTelemetry.INSTANCE.getFtcTelemetry());
        drivetrain.initialize(startPose);
        intake.initialize();
        if (Constants.Turret.enabled) turret.initialize();
        if (Constants.Shooter.enabled) shooter.initialize();
        transfer.initialize();
        flowerBar.initialize();
    }

    private Command stateCommand(State target) {
        switch (target) {
            case IDLE:
                return Groups.sequential(
                        turret.set(Turret.State.LOCKED),
                        intake.set(Intake.State.OFF),
                        shooter.set(Shooter.State.IDLE),
                        transfer.set(Transfer.State.OFF));
            case INTAKE:
                return Groups.sequential(
                        turret.set(Turret.State.LOCKED),
                        intake.set(Intake.State.INTAKE),
                        shooter.set(Shooter.State.IDLE),
                        transfer.set(Transfer.State.LOAD));
            case SHOOT:
                return Groups.sequential(
                        turret.set(Turret.State.LOCKED),
                        intake.set(Intake.State.OFF),
                        transfer.set(Transfer.State.OFF),
                        shooter.set(Shooter.State.REV),
                        Commands.waitUntil(shooter::atSpeed).raceWith(Commands.waitMs(Shooter.SPIN_UP_TIMEOUT_MS)),
                        intake.set(Intake.State.INTAKE),
                        transfer.set(Transfer.State.FEED));
            case UNJAM:
                return Groups.sequential(
                        turret.set(Turret.State.LOCKED),
                        intake.set(Intake.State.UNJAM),
                        shooter.set(Shooter.State.UNJAM),
                        transfer.set(Transfer.State.UNJAM));
            default:
                throw new IllegalStateException("No command for state " + target);
        }
    }

    public void configureBindings(Gamepad gamepad) {
        CommandGamepad controller = new CommandGamepad(gamepad);

        controller.leftBumper()
                .onTrue(set(State.INTAKE))
                .onFalse(set(State.IDLE));

        controller.rightBumper()
                .onTrue(set(State.SHOOT))
                .onFalse(set(State.IDLE));

        controller.b()
                .onTrue(set(State.UNJAM))
                .onFalse(set(State.IDLE));

        controller.x().onTrue(drivetrain.resetFieldCentric(alliance));
        controller.a().onTrue(drivetrain.resetPose(Constants.Drivetrain.resetPose));
        controller.y().onTrue(flowerBar.toggle());
        new Trigger(() -> gamepad.guide).onTrue(turret.toggleLock());

        drivetrain.drive(gamepad, alliance).schedule();
    }

    public State getState() {
        return state;
    }

    public Command set(State target) {
        return Groups.sequential(
                Commands.instant(() -> state = target).requiring(this),
                stateCommand(target)
        );
    }

    @Override
    public void periodic() {
        updateShot();
    }

    public void disabledPeriodic() {
        updateShot();
        drivetrain.periodic();
    }

    private void updateShot() {
        Follower follower = drivetrain.getFollower();
        if (follower != null) ShotCalculator.update(follower, alliance);
    }

    @NonNull
    @Override
    public Set<Mechanism> getMechanisms() {
        return new LinkedHashSet<>(Arrays.asList(drivetrain, intake, turret, shooter, transfer, flowerBar));
    }
}
